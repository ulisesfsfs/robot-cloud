# Pines, tópicos y acciones

## Pines de la Raspberry Pi y RaspiRobot

El código disponible solo analiza video y publica MQTT: aún no acciona motores
ni configura GPIO. No se conoce el modelo/revisión exacta de la placa RaspiRobot
ni su mapeo de pines; por eso no se asignan números BCM o pines físicos por
suposición. Confirmar el modelo y su documentación antes de conectar o mover
motores. No conectar motores directamente a los GPIO de la Raspberry Pi.

| Señal / función | Pin BCM | Pin físico | Estado |
|---|---:|---:|---|
| Motor izquierdo (dirección y PWM) | Por confirmar | Por confirmar | Pendiente de identificar la placa |
| Motor derecho (dirección y PWM) | Por confirmar | Por confirmar | Pendiente de identificar la placa |
| Alimentación y tierra del controlador | Según la placa | Según la placa | Verificar tensión y documentación |

Registrar aquí el mapeo verificado en el robot y mantener claro si los números
son BCM o físicos. La cámara del proyecto es el celular por Wi-Fi, no un GPIO. El dashboard muestra
su stream directamente desde el navegador; `vision.py` abre el stream por
separado para calcular detecciones y publicarlas por MQTT.

## MQTT

| Dirección | Tópico | Contenido |
|---|---|---|
| Python → broker | `robot/vision` | JSON de detección |
| Broker → Node-RED | `robot/vision` | El flujo actualiza el indicador de cámara en `/robot` y lo muestra en Debug |

Ejemplo de detección:

```json
{"detectado":true,"x":0.31,"area":0.05,"modo":"color"}
```

El publicador emite también mensajes con `"detectado": false` cuando no encuentra
un objeto. La IP/host y el puerto del broker se configuran al ejecutar
`vision.py` (`--broker`, `--puerto`) o con `MQTT_BROKER` y `MQTT_PORT`.
Node-RED necesita usar el mismo broker y el flujo de ejemplo debe configurarse
con una dirección alcanzable desde su proceso o contenedor.

La entrada MQTT solo actualiza el estado de visión que se muestra en el
dashboard. No está conectada a los nodos que accionan motores.

## Acciones a motores (propuesta para pruebas, no implementada)

Las acciones siguientes son una tabla de diseño inicial. No son comandos MQTT
implementados ni velocidades validadas para esta placa. Confirmar cómo espera
recibir órdenes el controlador de motores y comenzar con las ruedas levantadas,
en un área despejada y con PWM bajo.

| Acción | Motor izquierdo | Motor derecho | Velocidad inicial propuesta |
|---|---|---|---:|
| `AVANZAR` | Adelante | Adelante | 15 % |
| `GIRAR_IZQ` | Lento o detenido | Adelante | 10–15 % |
| `GIRAR_DER` | Adelante | Lento o detenido | 10–15 % |
| `FRENAR` | Detenido | Detenido | 0 % |
| `BUSCAR` | Girar lentamente | Girar lentamente en sentido opuesto | 10 % |

Revisar el sentido real de giro y ajustar las velocidades con el robot presente.
No conectar esta propuesta automáticamente al tópico de visión hasta definir
un protocolo de comandos separado, límites y una parada segura.
