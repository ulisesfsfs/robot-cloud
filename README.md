# Ojos para RaspiRobot

Proyecto para usar un celular como cámara IP, detectar color, movimiento o
códigos QR y mostrar el estado de visión en el tablero del RaspiRobot. El flujo
completo conserva el control del robot y el freno por distancia del SR04; la
visión solo informa y todavía no controla los motores.

## Requisitos

- Raspberry Pi 3 con Raspberry Pi OS y Python 3.
- Celular con una app de cámara IP, por ejemplo IP Webcam, y ambos equipos en
  la misma red.
- Broker MQTT accesible por la Raspberry Pi y por Node-RED (por ejemplo,
  Mosquitto).
- Node-RED con los módulos `node-red-node-pi-gpiod` y `node-red-node-pisrf`
  requeridos por los nodos GPIO y SR04 del robot.

## Instalar en la Raspberry Pi

La opción recomendada en Raspberry Pi OS es instalar los paquetes del sistema:

```bash
sudo apt update
sudo apt install python3-opencv python3-paho-mqtt python3-numpy python3-venv \
  mosquitto mosquitto-clients unzip
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

Una “rueda” (wheel) es un paquete precompilado de Python. En Raspberry Pi puede
no haber una rueda de `opencv-python` compatible con la arquitectura ARM o la
versión de Python instalada. Por eso, en la Pi se recomienda instalar OpenCV
con `apt` y crear el entorno virtual con `--system-site-packages`, para que ese
entorno pueda importar `cv2` desde los paquetes del sistema. No hace falta
instalar `opencv-python` con `pip` en la Pi.

## Preparar la Pi desde otra computadora

1. Conectá la computadora y la Raspberry Pi a la misma red. En una terminal de
   la computadora, conectate usando el usuario y la IP de la Pi:

   ```bash
   ssh USUARIO@IP_DE_LA_PI
   ```

   Aceptá la huella digital solo si confirmaste que corresponde a tu Pi y
   escribí la contraseña cuando la solicite (no se muestra al tipear). Para
   volver a la computadora, ejecutá `exit`.

2. Si la Pi tiene Internet, cloná el repositorio público directamente desde
   GitHub:

   ```bash
   git clone https://github.com/ulisesfsfs/robot-cloud.git ~/robot-cloud
   ```

   Si GitHub no está disponible en la red de la facultad, copiá un ZIP desde la
   computadora. En la computadora, desde el repo local, creá el archivo con el
   commit que querés llevar:

   ```bash
   git archive --format=zip -o ../robot-cloud-clase.zip HEAD
   scp ../robot-cloud-clase.zip USUARIO@IP_DE_LA_PI:~
   ```

   Después, en una sesión SSH con la Pi:

   ```bash
   mkdir -p ~/robot-cloud
   unzip -o ~/robot-cloud-clase.zip -d ~/robot-cloud
   ```

3. En la Pi, instalá los paquetes indicados arriba y creá el entorno:

   ```bash
   sudo apt update
   sudo apt install python3-opencv python3-paho-mqtt python3-numpy \
     python3-venv mosquitto mosquitto-clients unzip
   cd ~/robot-cloud
   python3 -m venv --system-site-packages .venv
   source .venv/bin/activate
   ```

   Los nodos de Node-RED para GPIO/SR04 son dependencias separadas. Confirmá
   que estén instalados en la Pi antes de probar motores o sensor.

## Ejecutar

### Datos que hay que configurar

Antes de ejecutar, anotá estos datos. Las direcciones IP pueden cambiar al
conectarse a otra red; confirmalas ese día y no las guardes en el repositorio.

| Dato | Qué valor usar | Dónde configurarlo |
|---|---|---|
| URL del video del celular | `http://IP_DEL_CELULAR:PUERTO/video` | En el campo “Cámara en vivo” del dashboard y en `--url` para el detector |
| Host del broker MQTT | `localhost` si Mosquitto corre en la misma Pi | `--broker` para Python y configuración `Broker MQTT del robot` en Node-RED |
| Puerto MQTT | Normalmente `1883` | `--puerto` y configuración del broker |
| Tópico de visión | `robot/vision` | Es el predeterminado del script y el tópico al que se suscribe el flujo |
| Modo y objetivo | Por ejemplo, modo `color` y color `verde` | Argumentos `--modo` y `--color` |
| Dirección del dashboard | `http://IP_DE_LA_PI:1880/robot` | Abrir en el navegador; requiere Node-RED en la Pi |

Para la prueba prevista, Mosquitto, Node-RED y `vision.py` corren en la misma
Pi: configurá `localhost` en los tres. El celular es la fuente de video y debe
estar en la misma red Wi‑Fi que la Pi; el navegador que abre el dashboard
también debe poder acceder a la URL de video. Si más adelante Node-RED corre en
Docker u otro equipo, `localhost` puede dejar de ser la dirección correcta.
La URL del stream se guarda en el navegador del dashboard; no queda escrita en
el flujo.

### Verificar Mosquitto antes de ejecutar

En una terminal de la Pi, comprobar si el servicio está instalado y activo:

```bash
systemctl is-active mosquitto
```

Si devuelve `active`, el servicio está corriendo. Si devuelve `inactive` o
`failed`, iniciarlo y revisar el resultado:

```bash
sudo systemctl start mosquitto
sudo systemctl status mosquitto --no-pager
```

Si indica que la unidad no existe, instalar el broker y sus clientes:

```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients
sudo systemctl start mosquitto
```

Comprobar que hay un proceso escuchando en el puerto MQTT habitual, `1883`:

```bash
sudo ss -ltnp 'sport = :1883'
```

Si la salida muestra `127.0.0.1:1883`, solo acepta clientes locales; alcanza
cuando `vision.py`, Mosquitto y Node-RED corren directamente en la misma Pi.
Si el publicador o Node-RED corren en otro dispositivo, el broker debe escuchar
en una interfaz de red alcanzable y el firewall debe permitir el puerto `1883`
desde esa red. No expongas el broker a Internet ni habilites conexiones
anónimas en una red no confiable.

Probar publicación y suscripción localmente en la Pi. En una terminal, dejar
esto escuchando:

```bash
mosquitto_sub -h 127.0.0.1 -t robot/vision -v
```

En otra terminal, publicar un mensaje de prueba:

```bash
mosquitto_pub -h 127.0.0.1 -t robot/vision \
  -m '{"detectado":true,"x":0.5,"area":0.01,"modo":"prueba"}'
```

El mensaje debe aparecer en la terminal de `mosquitto_sub`. Para verificar un
broker en otro equipo, reemplazar `127.0.0.1` por su host/IP en ambos comandos;
esa conexión también tiene que estar permitida por la configuración de red y
firewall.

La autenticación MQTT es una opción del broker para exigir usuario y contraseña
a cada cliente. Para la prueba local en una sola Pi, no necesitás configurar
credenciales si Mosquitto acepta conexiones locales sin autenticación (la
configuración local predeterminada habitual). Si al conectar aparece
`Not authorized`, el broker está configurado para pedir credenciales; la versión
actual de `vision.py` no acepta usuario y contraseña, así que no cambies el
broker a ciegas: revisá su configuración con quien administre la Pi. No guardes
contraseñas en el código, el README ni el flujo exportado.

### Ejecutar el detector

Iniciá la app de cámara IP en el celular y averiguá la URL de video. Luego:

```bash
python vision.py --url http://IP_DEL_CELULAR:PUERTO/video \
  --modo color --color verde --broker localhost --puerto 1883 \
  --topic robot/vision
```

El puerto debe coincidir con el configurado en la app. Modos disponibles:
`color` (`verde`, `azul`, `amarillo`, `rojo`), `movimiento` y `qr`.
El script no abre una ventana local por defecto: el video se ve en el dashboard.
Agregar `--ver` solo si se quiere abrir una vista de diagnóstico en la pantalla
de la computadora que ejecuta Python. Para probar detección sin MQTT, agregar
`--sin-mqtt` (esto no envía datos al dashboard).

También se pueden pasar la URL y los datos del broker mediante variables de
entorno, sin editar el código:

```bash
export VISION_URL="http://IP_DEL_CELULAR:PUERTO/video"
export MQTT_BROKER="localhost"
export MQTT_PORT=1883
export MQTT_TOPIC="robot/vision"
python vision.py --modo color --color verde
```

`--url` y `--broker` también pueden pasarse como argumentos y prevalecen sobre
las variables de entorno. El modo y el color se seleccionan con argumentos.
`VISION_URL` es obligatorio si no se da `--url`. El broker predeterminado es
`localhost`; usalo solo si Mosquitto corre en el mismo equipo donde se ejecuta
Python.

## Integrar con el tablero del robot y probar MQTT

`flows/flow_vision.json` contiene el flujo completo exportado del robot
(movimiento, tablero web, servo y SR04), una vista en vivo configurable de la
cámara del celular y el indicador de detección recibido por MQTT. Antes de
reemplazar el flujo de Node-RED, exportá una copia de seguridad. Si ya
importaste flujos anteriores de este proyecto,
eliminá únicamente sus pestañas `Movimiento robot`, `Robot Dashboard` y
`Vision RaspiRobot` (si existen) antes de importar el flujo completo; así
evitás dejar controles o rutas HTTP duplicadas. No borres otras pestañas tuyas.

1. Importar `flows/flow_vision.json` desde el menú de Node-RED (Import > select
   a file). En la configuración `Broker MQTT del robot`, reemplazar
   `CAMBIAR_HOST_DEL_BROKER` por `localhost`, dado que Mosquitto y Node-RED
   correrán directamente en la misma Pi. Si Node-RED estuviera en Docker, esta
   dirección tendría que revisarse porque `localhost` apuntaría al contenedor.
2. Confirmar que Node-RED tiene los módulos `node-red-node-pi-gpiod` y
   `node-red-node-pisrf` instalados. Si faltan, instalarlos desde **Menu >
   Manage palette > Install** y reiniciar Node-RED si lo solicita.
3. Implementar el flujo y abrir `http://IP_DE_LA_MAQUINA_NODE_RED:1880/robot`.
   En la sección “Cámara en vivo”, ingresá la URL del celular
   (por ejemplo `http://IP_DEL_CELULAR:8080/video`) y presioná “Conectar”. La
   dirección se guarda solo en el navegador; no se agrega al flujo del repo.
   El celular debe seguir transmitiendo y el navegador que muestra el tablero
   debe poder acceder a esa URL.
4. Ejecutar `vision.py` con `--broker localhost`. El script y Node-RED deben
   usar el mismo tópico `robot/vision`. El tablero mostrará modo, detección y
   posición mientras el script siga ejecutándose. La vista del video y el
   proceso de detección son independientes.

### Secuencia rápida de prueba en clase

1. En la Pi, verificar Mosquitto y el puerto `1883` siguiendo los pasos
   anteriores.
2. En Node-RED, exportar una copia de seguridad, importar este flujo, cambiar
   el broker a `localhost` y hacer Deploy. Confirmar que estén instalados los
   módulos de Node-RED para GPIO/SR04.
3. Desde el navegador de un equipo en la misma red, abrir
   `http://IP_DE_LA_PI:1880/robot`. Iniciar la app de cámara del celular,
   ingresar su URL en “Cámara en vivo” y conectar. El navegador debe poder
   acceder a esa URL.
4. En una terminal SSH de la Pi, ejecutar `cd ~/robot-cloud` y
   `source .venv/bin/activate`; luego iniciar `vision.py` con la URL del celular
   y `--broker localhost`, sin `--sin-mqtt`. Dejar el proceso corriendo para
   que sigan llegando las detecciones.
5. Presentar un objeto del color elegido y confirmar en el dashboard el estado
   y la posición. Detener el detector con `Ctrl+C`.
6. Probar motores y SR04 solo después de comprobar el mapeo de pines y la placa;
   comenzar con las ruedas levantadas, velocidad baja y una forma inmediata de
   frenar.

Para observar mensajes desde una terminal adicional:

```bash
mosquitto_sub -h 127.0.0.1 -t robot/vision -v
```

Cada mensaje es JSON, por ejemplo:

```json
{"detectado":true,"x":0.31,"area":0.05,"modo":"color"}
```

`x` es la posición horizontal normalizada (0 izquierda, 0.5 centro, 1 derecha);
`area` es la fracción de imagen ocupada y solo aproxima el tamaño aparente.
En modo QR también se publica `texto`.

### Si el video se ve lento o se traba

El video del dashboard va directamente del celular al navegador. El parámetro
`--hz` de `vision.py` limita solo la frecuencia de mensajes de detección MQTT;
no aumenta los FPS de la cámara. Ajustá en la app del celular una resolución
moderada (por ejemplo 640x480 o 320x240), bajá la calidad si la red está
cargada y seleccioná una tasa de cuadros estable. Confirmá que el stream abra
sin cortes directamente desde el navegador en
`http://IP_DEL_CELULAR:PUERTO/video` y que ambos equipos estén en una red local
con buena señal Wi-Fi. Luego ingresá esa misma URL en el panel “Cámara en vivo”.

La detección procesa cuadros reducidos a 320x240 para limitar el trabajo en la
Raspberry Pi. Si el video del navegador está fluido pero las detecciones llegan
con demora, revisar carga de CPU de la Pi y reducir `--hz` (por ejemplo
`--hz 5`); esto reduce publicaciones MQTT, no los FPS del video.

El indicador de detección marca que no hay señal si no recibe un mensaje en
3 segundos. El video en vivo se conecta directamente desde el navegador al
celular y puede seguir viéndose aunque `vision.py` esté detenido. Para
actualizar detecciones y posición, sí se necesita el script en ejecución. La
integración no activa conducción automática: los
comandos del joystick y el freno del SR04 conservan su funcionamiento original.

### Qué falta para que la visión mueva el robot

Actualmente `vision.py` analiza el video y publica detecciones en `robot/vision`.
Node-RED valida esos mensajes y los muestra en el dashboard, pero no los conecta
a los nodos de motores o servo. El control de actuadores sigue siendo manual y
el SR04 mantiene su freno por distancia.

Para agregar seguimiento visual, primero hay que decidir el comportamiento
(por ejemplo, girar el servo hacia un objeto del color elegido), cómo se activa
y desactiva el modo automático y qué hacer cuando se pierde la detección.
Después se integra esa lógica en Node-RED con límites de velocidad, parada
segura y prioridad del SR04, y se valida con el robot presente. No se debe
interpretar `area` como una medición de distancia ni mover el robot basándose
solo en la detección visual.

## Orden sugerido de pruebas

1. Confirmar que celular y Pi se ven en la misma red y que la URL de video abre.
2. Ejecutar la detección con `--sin-mqtt` y verificar el encuadre y el
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

## Solución de problemas frecuentes

### `ssh`: conexión rechazada o timeout

En la computadora, verificá que estés en la misma red y que la IP y el usuario
sean los de la Pi:

```bash
ssh USUARIO@IP_DE_LA_PI
```

Si la Pi responde “connection refused” y tenés acceso a su terminal, comprobá
SSH e iniciá el servicio:

```bash
sudo systemctl status ssh --no-pager
sudo systemctl enable --now ssh
```

Si `ssh.service` no existe, instalá el servidor SSH desde la terminal de la Pi:

```bash
sudo apt update
sudo apt install openssh-server
sudo systemctl enable --now ssh
```

Un timeout suele indicar IP incorrecta, equipos en redes distintas o SSH no
habilitado. No desactives el firewall completo; pedí ayuda al responsable de la
red si el puerto SSH está bloqueado.

### `apt update` falla o no encuentra paquetes

Comprobá conexión, resolución DNS y hora:

```bash
ping -c 3 1.1.1.1
getent hosts deb.debian.org
timedatectl status
```

Si la hora está incorrecta y la Pi tiene red, habilitá la sincronización y
reintentá:

```bash
sudo timedatectl set-ntp true
sudo apt update
```

Si `apt` informa que un paquete no tiene candidato, verificá la versión del
sistema y si el repositorio ofrece los paquetes:

```bash
cat /etc/os-release
apt-cache policy python3-opencv python3-paho-mqtt python3-numpy
```

No reemplaces automáticamente OpenCV del sistema con `pip`: la rueda puede no
ser compatible con la Pi.

### `externally-managed-environment` al instalar con `pip`

Ese mensaje protege el Python administrado por Raspberry Pi OS. No uses
`sudo pip` ni `--break-system-packages`. Instalá las dependencias con `apt` y
creá/activá el entorno así:

```bash
sudo apt install python3-opencv python3-paho-mqtt python3-numpy python3-venv
cd ~/robot-cloud
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
```

### `No module named cv2` o `No module named paho`

Confirmá que el entorno está activado y que se creó con
`--system-site-packages`:

```bash
cd ~/robot-cloud
source .venv/bin/activate
python -c 'import cv2, numpy, paho.mqtt.client; print("OpenCV", cv2.__version__); print("NumPy", numpy.__version__); print("Paho MQTT: OK")'
```

Si la importación falla, instalá los paquetes del sistema y volvé a crear el
entorno para asegurar que tenga acceso a ellos:

```bash
deactivate 2>/dev/null || true
sudo apt update
sudo apt install --reinstall python3-opencv python3-paho-mqtt python3-numpy python3-venv
python3 -m venv --clear --system-site-packages .venv
source .venv/bin/activate
python -c 'import cv2, numpy, paho.mqtt.client; print("Dependencias Python: OK")'
```

`--clear` reemplaza el contenido del entorno `.venv` de este proyecto; no borra
el código del repo.

### Mosquitto: `Connection refused` o no aparecen mensajes

En la Pi, comprobá e iniciá el broker:

```bash
systemctl is-active mosquitto
sudo systemctl enable --now mosquitto
sudo ss -ltnp 'sport = :1883'
```

Si Mosquitto no está instalado:

```bash
sudo apt update
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto
```

Como todo corre en la misma Pi, configurá `localhost` en Node-RED y usá
`--broker localhost` en `vision.py`. Probá el tópico en dos terminales de la
Pi: en una ejecutá `mosquitto_sub -h 127.0.0.1 -t robot/vision -v`; en la otra:

```bash
mosquitto_pub -h 127.0.0.1 -t robot/vision \
  -m '{"detectado":true,"x":0.5,"area":0.01,"modo":"prueba"}'
```

Si el comando no existe, instalá `mosquitto-clients`. Si aparece
`Not authorized`, el broker exige credenciales: no desactives la seguridad ni
cambies su configuración a ciegas; el script actual no admite usuario y
contraseña.

### La cámara no abre o el dashboard dice “Cámara sin señal”

- Asegurate de que la app del celular esté transmitiendo y que la URL termine
  con la ruta correcta, normalmente `/video`.
- Desde el navegador del dashboard, abrí directamente
  `http://IP_DEL_CELULAR:PUERTO/video`. Si no abre ahí, revisá Wi-Fi, IP y
  puerto antes de probar Python.
- Ingresá la misma URL en “Cámara en vivo” y en `--url` de `vision.py`. Tanto
  el navegador como la Pi necesitan alcanzar el celular.
- Ejecutá el detector sin `--sin-mqtt` y con `--broker localhost`. El video
  puede verse aunque el detector esté detenido, pero el estado de detección
  requiere que el proceso siga corriendo.
- Si `vision.py` muestra “Sin imagen. Reintentando…”, detenelo con `Ctrl+C`,
  revisá la URL y probá de nuevo.

### Video lento o ventana local inesperada

El video del dashboard va directamente del celular al navegador. Bajá la
resolución/calidad o el FPS de la app del celular y probá una red Wi-Fi estable.
`--hz` limita publicaciones MQTT, no los FPS del video. El script no abre una
ventana local salvo que agregues `--ver`; quitá esa opción para ejecutar sin
ventana.

### Node-RED muestra nodos GPIO/SR04 desconocidos

En Node-RED abrí **Menu > Manage palette > Install** e instalá
`node-red-node-pi-gpiod` y `node-red-node-pisrf`; reiniciá Node-RED si lo pide.
Hacé una copia de seguridad del flujo antes de importar o reemplazar pestañas.
No pruebes motores hasta confirmar que los pines coinciden con la placa real.

La detección de visión solo informa en el dashboard: no manda órdenes a los
motores. El SR04 y su lógica de freno se mantienen aparte. No guardes
contraseñas, claves privadas, certificados ni IPs personales en el código o en
el flujo; revisá los cambios antes de publicar el repo.

## Actualizar el repositorio público de GitHub

Después de revisar los cambios, subilos desde esta carpeta:

```bash
git status
git add README.md docs/pines.md flows/flow_vision.json
git diff --cached --check
git commit -m "Integrar estado de camara al flujo del robot"
git push
```

Si el remoto todavía no está configurado, agregá la URL del repo público:

```bash
git remote add origin https://github.com/ulisesfsfs/robot-cloud.git
```

Revisá que no haya secretos o archivos locales antes de publicar cambios.
