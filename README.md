# Ojos para RaspiRobot

Proyecto para usar un celular como cámara IP, detectar color, movimiento o
códigos QR en una Raspberry Pi 3 y enviar los resultados por MQTT a Node-RED.
La detección publica datos de visión; todavía no controla los motores.

## Requisitos

- Raspberry Pi 3 con Raspberry Pi OS y Python 3.
- Celular con una app de cámara IP, por ejemplo IP Webcam, y ambos equipos en
  la misma red.
- Broker MQTT accesible por la Raspberry Pi y por Node-RED (por ejemplo,
  Mosquitto).
- Node-RED. El flujo de ejemplo usa nodos incluidos con Node-RED, sin nodos de
  dashboard adicionales.

## Instalar en la Raspberry Pi

La opción recomendada en Raspberry Pi OS es instalar los paquetes del sistema:

```bash
sudo apt update
sudo apt install python3-opencv python3-paho-mqtt python3-numpy python3-venv
```

Desde la carpeta del proyecto, crear un entorno que pueda usar esos paquetes:

```bash
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
```

Si se usa un entorno virtual aislado en otro sistema, instalar las dependencias
de `requirements.txt`:

```bash
python -m pip install -r requirements.txt
```

En Raspberry Pi, `opencv-python` de PyPI puede no tener una rueda adecuada para
el sistema o la arquitectura; en ese caso, usar los paquetes `apt` anteriores
y no instalar OpenCV con `pip`.

## Ejecutar

Iniciar la app de cámara IP en el celular y averiguar su URL de video. Luego:

```bash
python vision.py --url http://IP_DEL_CELULAR:PUERTO/video \
  --modo color --color verde --broker IP_DE_LA_PI --ver
```

El puerto debe coincidir con el configurado en la app. Modos disponibles:
`color` (`verde`, `azul`, `amarillo`, `rojo`), `movimiento` y `qr`.
Para probar solo la cámara y la detección sin MQTT, agregar `--sin-mqtt`.

También se pueden pasar valores sin editar el código:

```bash
export VISION_URL="http://IP_DEL_CELULAR:PUERTO/video"
export MQTT_BROKER="IP_DE_LA_PI"
export MQTT_PORT=1883
export MQTT_TOPIC="robot/vision"
python vision.py --modo color --color verde --ver
```

`--url` y `--broker` también pueden pasarse como argumentos y prevalecen sobre
las variables de entorno. `VISION_URL` es obligatorio si no se da `--url`.
El broker predeterminado es `localhost`; cuando el broker está en la Pi,
configurarlo explícitamente si el script corre en otro equipo.

## Conectar Node-RED y probar MQTT

1. Importar [`flows/flow_vision.json`](flows/flow_vision.json) desde el menú de
   Node-RED (Import > select a file).
2. Editar la configuración del broker MQTT del flujo y reemplazar
   `CAMBIAR_IP_DE_LA_PI` por el host o IP alcanzable desde Node-RED. Si
   Node-RED corre en Docker, `localhost` apunta al contenedor, no a la Pi.
3. Implementar y desplegar el flujo. El nodo Debug muestra el JSON recibido
   desde el tópico `robot/vision`.
4. Ejecutar `vision.py` con `--broker` apuntando al mismo broker. El proceso
   que publica y Node-RED deben usar el mismo tópico.

Para observar mensajes desde una terminal adicional:

```bash
mosquitto_sub -h IP_DEL_BROKER -t robot/vision -v
```

Cada mensaje es JSON, por ejemplo:

```json
{"detectado":true,"x":0.31,"area":0.05,"modo":"color"}
```

`x` es la posición horizontal normalizada (0 izquierda, 0.5 centro, 1 derecha);
`area` es la fracción de imagen ocupada y solo aproxima el tamaño aparente.
En modo QR también se publica `texto`.

## Orden sugerido de pruebas

1. Confirmar que celular y Pi se ven en la misma red y que la URL de video abre.
2. Ejecutar la detección con `--sin-mqtt --ver` y verificar el encuadre y el
   color; ajustar la luz y probar movimiento y QR si corresponde.
3. Probar Mosquitto por separado con `mosquitto_sub` y comprobar el tópico.
4. Importar Node-RED, configurar el broker y confirmar que su Debug recibe los
   mensajes publicados por el script (sin `--sin-mqtt`).
5. Repetir varias veces y registrar resolución, FPS observados y latencia
   aproximada para el informe. El script actual no calcula esas métricas.
6. Guardar aparte un video de respaldo donde se vea la detección y Node-RED
   reaccionando. No se incluye un video porque aún no hay una captura del
   proyecto.
7. Con el robot presente, confirmar el mapeo de motores y probar primero a
   velocidad baja; consultar [`docs/pines.md`](docs/pines.md).

## Problemas conocidos y seguridad

- Si `venv` muestra `externally-managed-environment`, no instalar paquetes en
  el Python administrado por el sistema. Crear el entorno como arriba con
  `--system-site-packages` y usar los paquetes `apt`.
- Si no llegan imágenes, revisar que la app siga transmitiendo, la ruta
  (`/video`), el puerto y que la red permita conexiones entre dispositivos.
- Si Node-RED está en Docker, configurar en el broker una dirección accesible
  desde el contenedor. Revisar también el firewall y que Mosquitto escuche en
  la interfaz de red necesaria.
- No guardar contraseñas, claves privadas, certificados ni IPs personales en el
  código o en el flujo. El `.gitignore` excluye `.env` y archivos `*.pem`, pero
  revisar los cambios antes de publicar.

## Subirlo a la otra cuenta de GitHub

Este directorio no está inicializado como repositorio Git y no se creó ni subió
nada a GitHub. En la cuenta correcta, crear un repositorio **privado**, agregar
a los compañeros como colaboradores y luego, desde esta carpeta, ejecutar los
comandos que GitHub indique. Por ejemplo:

```bash
git init
git add README.md requirements.txt vision.py flows/ docs/ .gitignore
git commit -m "Preparar proyecto de vision para RaspiRobot"
git branch -M main
git remote add origin URL_DEL_REPOSITORIO_PRIVADO
git push -u origin main
```

Antes de `git add`, confirmar que se está usando la cuenta correcta y revisar
que no haya secretos o archivos locales en los cambios.
