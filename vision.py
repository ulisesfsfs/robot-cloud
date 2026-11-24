#!/usr/bin/env python3
"""
Vision para el robot: lee el stream de IP Webcam, analiza cada cuadro con OpenCV
y publica el resultado por MQTT (por defecto en el topico robot/vision).

Ejemplos:
  python vision.py --url http://IP_DEL_CELULAR:PUERTO/video --modo color --color todos
  python vision.py --url http://IP_DEL_CELULAR:PUERTO/video --modo movimiento
  python vision.py --url http://IP_DEL_CELULAR:PUERTO/video --modo qr --sin-mqtt

Mensaje publicado (JSON):
  {"modo": "color", "detectado": true, "color": "verde",
   "colores": ["verde"], "x": 0.31, "area": 0.05}
  x    = posicion horizontal del objeto (0 = izquierda, 0.5 = centro, 1 = derecha)
  area = fraccion de la imagen que ocupa (sirve como estimacion de cercania)
  En modo qr se agrega "texto" con el contenido del codigo.
"""
import argparse
import json
import os
import sys
import time

import cv2
import numpy as np

# Rangos HSV (OpenCV: H 0-179, S y V 0-255). Ajustar segun la luz y el objeto.
COLORES = {
    "verde":    [((35, 80, 50), (85, 255, 255))],
    "azul":     [((95, 100, 50), (130, 255, 255))],
    "amarillo": [((20, 100, 100), (35, 255, 255))],
    "rojo":     [((0, 120, 70), (10, 255, 255)), ((170, 120, 70), (179, 255, 255))],
}
COLORES_INDICADORES = ("verde", "rojo", "amarillo")


def _detectar_color_hsv(hsv, rangos, area_min):
    mask = None
    for lo, hi in rangos:
        m = cv2.inRange(hsv, np.array(lo), np.array(hi))
        mask = m if mask is None else cv2.bitwise_or(mask, m)
    mask = cv2.dilate(cv2.erode(mask, None, iterations=2), None, iterations=2)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = hsv.shape[:2]
    if not cnts:
        return {"detectado": False}
    c = max(cnts, key=cv2.contourArea)
    area = cv2.contourArea(c) / (w * h)
    if area < area_min:
        return {"detectado": False}
    x, y, bw, bh = cv2.boundingRect(c)
    return {"detectado": True, "x": round((x + bw / 2) / w, 3),
            "area": round(area, 4), "_caja": (x, y, bw, bh)}


def detectar_color(frame, rangos, area_min=0.002):
    """Busca la mancha mas grande del color pedido."""
    hsv = cv2.cvtColor(cv2.GaussianBlur(frame, (5, 5), 0), cv2.COLOR_BGR2HSV)
    return _detectar_color_hsv(hsv, rangos, area_min)


def detectar_colores(frame, area_min=0.002):
    """Detecta verde, rojo y amarillo a la vez; devuelve el mayor como objetivo."""
    hsv = cv2.cvtColor(cv2.GaussianBlur(frame, (5, 5), 0), cv2.COLOR_BGR2HSV)
    encontrados = []
    for nombre in COLORES_INDICADORES:
        resultado = _detectar_color_hsv(hsv, COLORES[nombre], area_min)
        if resultado["detectado"]:
            encontrados.append((nombre, resultado))
    if not encontrados:
        return {"detectado": False, "colores": []}

    color, mayor = max(encontrados, key=lambda item: item[1]["area"])
    return {
        **mayor,
        "color": color,
        "colores": [nombre for nombre, _ in encontrados],
    }


def detectar_movimiento(gris_prev, frame, umbral=25, area_min=0.01):
    """Compara con el cuadro anterior. Devuelve (gris_actual, resultado)."""
    gris = cv2.GaussianBlur(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), (21, 21), 0)
    if gris_prev is None:
        return gris, {"detectado": False}
    dif = cv2.absdiff(gris_prev, gris)
    mask = cv2.dilate(cv2.threshold(dif, umbral, 255, cv2.THRESH_BINARY)[1], None, iterations=2)
    h, w = mask.shape[:2]
    area = cv2.countNonZero(mask) / (w * h)
    if area < area_min:
        return gris, {"detectado": False}
    x, y, bw, bh = cv2.boundingRect(mask)
    return gris, {"detectado": True, "x": round((x + bw / 2) / w, 3),
                  "area": round(area, 4), "_caja": (x, y, bw, bh)}


def detectar_qr(frame, detector):
    texto, pts, _ = detector.detectAndDecode(frame)
    if not texto or pts is None:
        return {"detectado": False}
    h, w = frame.shape[:2]
    xs = pts[0][:, 0]
    ys = pts[0][:, 1]
    bw, bh = xs.max() - xs.min(), ys.max() - ys.min()
    return {"detectado": True, "texto": texto, "x": round(float(xs.mean()) / w, 3),
            "area": round(float(bw * bh) / (w * h), 4),
            "_caja": (int(xs.min()), int(ys.min()), int(bw), int(bh))}


def crear_cliente_mqtt(host, port):
    import paho.mqtt.client as mqtt
    try:                                   # paho-mqtt 2.x
        cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:                 # paho-mqtt 1.x
        cli = mqtt.Client()
    cli.connect(host, port, 60)
    cli.loop_start()
    return cli


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.getenv("VISION_URL"),
                    help="stream MJPEG de IP Webcam (o variable VISION_URL)")
    ap.add_argument("--modo", choices=["color", "movimiento", "qr"], default="color")
    ap.add_argument("--color", choices=[*COLORES, "todos"], default="verde",
                    help="color a detectar o 'todos' para verde, rojo y amarillo")
    ap.add_argument("--broker", default=os.getenv("MQTT_BROKER", "localhost"),
                    help="host del broker MQTT (o variable MQTT_BROKER)")
    ap.add_argument("--puerto", type=int, default=int(os.getenv("MQTT_PORT", "1883")),
                    help="puerto MQTT (o variable MQTT_PORT)")
    ap.add_argument("--topic", default=os.getenv("MQTT_TOPIC", "robot/vision"),
                    help="topico MQTT (o variable MQTT_TOPIC)")
    ap.add_argument("--hz", type=float, default=10,
                    help="maximo de mensajes MQTT por segundo (no cambia los FPS del video)")
    ap.add_argument("--ver", action="store_true",
                    help="mostrar una ventana local de vista previa (desactivada por defecto)")
    ap.add_argument("--sin-mqtt", action="store_true", help="solo imprimir, sin publicar")
    a = ap.parse_args()
    if not a.url:
        ap.error("indica --url o configura VISION_URL")
    if a.hz <= 0:
        ap.error("--hz debe ser mayor que cero")

    cli = None if a.sin_mqtt else crear_cliente_mqtt(a.broker, a.puerto)
    qr = cv2.QRCodeDetector() if a.modo == "qr" else None
    gris_prev, ultimo_envio = None, 0.0

    cap = cv2.VideoCapture(a.url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)     # menos retraso (no todos los backends lo respetan)
    print(f"Modo: {a.modo} | Fuente: {a.url} | MQTT: {'no' if cli is None else a.broker + '/' + a.topic}")

    while True:
        ok, frame = cap.read()
        if not ok:
            print("Sin imagen. Reintentando...", file=sys.stderr)
            cap.release(); time.sleep(1); cap = cv2.VideoCapture(a.url)
            continue
        frame = cv2.resize(frame, (320, 240))      # chico = mas rapido en la Raspberry

        if a.modo == "color":
            if a.color == "todos":
                res = detectar_colores(frame)
            else:
                res = detectar_color(frame, COLORES[a.color])
                res["colores"] = [a.color] if res["detectado"] else []
                if res["detectado"]:
                    res["color"] = a.color
        elif a.modo == "movimiento":
            gris_prev, res = detectar_movimiento(gris_prev, frame)
        else:
            res = detectar_qr(frame, qr)

        caja = res.pop("_caja", None)
        res["modo"] = a.modo

        ahora = time.time()
        if ahora - ultimo_envio >= 1.0 / a.hz:
            msg = json.dumps(res, ensure_ascii=False)
            if cli: cli.publish(a.topic, msg)
            else:   print(msg)
            ultimo_envio = ahora

        if a.ver:
            if caja:
                x, y, bw, bh = caja
                dibujo = {"verde": (0, 255, 0), "rojo": (0, 0, 255),
                          "amarillo": (0, 255, 255)}.get(res.get("color"), (255, 255, 255))
                cv2.rectangle(frame, (x, y), (x + bw, y + bh), dibujo, 2)
            cv2.imshow("vision_robot (q para salir)", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cap.release()
    if a.ver:
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
