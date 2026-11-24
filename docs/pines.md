# Pines, tópicos y acciones

## Pines de Raspberry Pi y RaspiRobot

Estos son los pines BCM configurados en el último export de Node-RED compartido
en clase. Confirmá que coincidan con la revisión de la placa y el cableado real
antes de energizar o mover el robot. No conectes motores directamente a los
GPIO de la Raspberry Pi: deben ir al controlador de motores correspondiente.

| Señal / función | Pin BCM | Uso en el flujo |
|---|---:|---|
| Motor izquierdo PWM | 24 | Control manual |
| Motor izquierdo dirección 1 | 17 | Control manual |
| Motor izquierdo dirección 2 | 4 | Control manual |
| Motor derecho PWM | 14 | Control manual |
| Motor derecho dirección 1 | 10 | Control manual |
| Motor derecho dirección 2 | 25 | Control manual |
| Servo de dirección | 2 | Control manual |
| HC-SR04 Trigger | 18 | Script `RPi.GPIO` generado por Node-RED |
| HC-SR04 Echo | 23 | Script `RPi.GPIO` generado por Node-RED |
| LED rojo | 11 | Semáforo de proximidad / color rojo detectado |
| LED amarillo | 22 | Marcha atrás / color amarillo detectado |
| LED verde | 9 | Camino libre / color verde detectado |
| Buzzer pasivo | 15 | Aviso junto al LED rojo |

El HC-SR04 suele emitir 5 V en Echo, mientras que los GPIO de la Pi son de
3,3 V. Usá un divisor de tensión o conversor de nivel adecuado en Echo; no lo
conectes directamente al GPIO. Usá resistencias limitadoras con los LEDs y
verificá que el buzzer y la alimentación sean adecuados para GPIO. La cámara es
el celular por Wi-Fi, no un GPIO.

El inject `Iniciar sensor` escribe `/tmp/sonar_robot.py` y lo lanza con
`python3 -u` una vez al iniciar el flow. El proceso requiere `python3-rpi.gpio`
y permisos para que el usuario de Node-RED acceda a GPIO.
También intenta ejecutar `pigs pads 0 16`; esto depende de que el comando `pigs`
esté disponible en el sistema. Revisá Debug/errores del nodo antes de asumir
que el ajuste de pines se aplicó.

## MQTT

| Dirección | Tópico | Contenido |
|---|---|---|
| Python → broker | `robot/vision` | JSON de detección |
| Broker → Node-RED | `robot/vision` | El flujo actualiza el estado de visión del tablero `/robot` y lo muestra en Debug |

Ejemplo de detección:

```json
{"detectado":true,"color":"verde","colores":["verde","amarillo"],"x":0.31,"area":0.05,"modo":"color"}
```

El publicador emite también mensajes con `"detectado": false` cuando no encuentra
un objeto. La IP/host y el puerto del broker se configuran al ejecutar
`vision.py` (`--broker`, `--puerto`) o con `MQTT_BROKER` y `MQTT_PORT`.
Node-RED necesita usar el mismo broker y el flujo de ejemplo debe configurarse
con una dirección alcanzable desde su proceso o contenedor.

La entrada MQTT actualiza el estado de visión y alimenta el modo opcional
**Seguimiento visual** del dashboard. El modo está apagado al iniciar y no usa
`area` para calcular distancia.

Para detectar los tres colores a la vez, ejecutar `vision.py` con
`--modo color --color todos`. Node-RED enciende los LEDs correspondientes a
todos los colores detectados; el objeto de mayor área se conserva como objetivo
del seguimiento. El último color positivo se mantiene hasta 0,75 s para evitar
parpadeos entre cuadros. Si no se detecta un color, los LEDs vuelven a indicar el
estado normal del robot. La indicación de seguridad del semáforo (obstáculo o
falta de actualización del HC-SR04) tiene prioridad y muestra rojo con buzzer;
detectar un objeto rojo por sí solo no activa el buzzer. El semáforo del
dashboard refleja las luces físicas e indica “Detectado: ...” o el motivo de
la alerta; “HC-SR04 sin datos” significa que primero hay que revisar el sensor
o su nodo de lectura.

## Seguimiento visual automático (experimental)

Al activarlo, `x` entre 0 y 1 dirige el servo hacia el objeto. La velocidad
base es 45 % de PWM; `Control robot` agrega hasta 9 puntos porcentuales al
girar (54 % como máximo). La orden de giro se limita a ±60 y `Control robot`
la restringe además al 40 % del recorrido configurado del servo. La zona
muerta es `0.42–0.58`. El 45 % es el mínimo de marcha definido por el control
existente, no una velocidad segura validada en el robot.

Ante pérdida del objeto durante 0,5 s, el robot se detiene pero el modo queda
armado y reanuda automáticamente si vuelve a detectarlo. El modo se desarma
ante silencio MQTT durante 0,75 s o bloqueo/error del HC-SR04. STOP y
cualquier orden manual también cancelan el modo. No se implementa una acción
`BUSCAR`: mientras no haya detección, el robot se queda detenido.

Antes de probar movimiento real, verificar el sentido del servo y de los
motores, probar STOP y el SR04, y empezar con las ruedas levantadas en un área
despejada. Ajustar los límites con el hardware presente; ni el sentido ni la
velocidad física pueden validarse desde este repositorio.
