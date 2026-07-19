# I have to go.. forever — escena audiovisual

Experiencia web interactiva creada para promocionar **“I have to go.. forever” de Creador100k**. La escena transforma una imagen estática en un loop cinematográfico: el personaje y la cámara permanecen inmóviles mientras el portal, la luz, las partículas y el entorno reaccionan de forma sutil a la música.

![Arte de la escena](Imagen1.png)

## Concepto

La composición funciona como un plano suspendido en el tiempo. El personaje actúa como ancla visual y el mundo parece ser atraído lentamente hacia el portal. La animación combina movimiento ambiental continuo con reacciones sincronizadas al audio para que la imagen conserve su identidad y, al mismo tiempo, se sienta viva.

## Efectos visuales

- Respiración y energía interna del portal.
- Ecualizador radial integrado en el borde del portal.
- Cambios de intensidad y color según la fuerza del sonido.
- Flash ambiental suave activado por los graves.
- Onda expansiva en cámara superlenta, con pausa entre explosiones.
- Partículas, polvo y pequeñas descargas atraídas hacia el centro.
- Sensación de profundidad y gravedad en piedras y objetos laterales.
- Vibración localizada en el reflejo del agua.
- Distorsión térmica alrededor del portal.
- Movimiento atmosférico muy lento en nubes y luz.

El personaje, la cámara, el horizonte y la posición del portal permanecen fijos. Los efectos están en capas independientes de `canvas`, de modo que el movimiento no deforma la figura humana.

## Reproductor

La interfaz muestra:

- **Listening to:** nombre de la canción y artista.
- Un preview limitado a los primeros **1:40**.
- Botón independiente de reproducción y pausa.
- Barra de progreso interactiva para adelantar o retroceder.
- Alternancia de pantalla completa al presionar la información de la canción.

El ecualizador y varios efectos de iluminación analizan el audio en tiempo real mediante la Web Audio API.

## Ejecutar el proyecto

### Opción rápida en Windows

Con [Node.js](https://nodejs.org/) instalado, ejecutá:

```text
iniciar-loop.cmd
```

El archivo inicia el servidor y abre automáticamente:

```text
http://127.0.0.1:4173
```

### Desde una terminal

```bash
node server.js
```

Después abrí `http://127.0.0.1:4173` en el navegador.

> El proyecto debe abrirse desde el servidor local. Si se abre `index.html` directamente como archivo, el navegador puede bloquear la carga o el análisis del audio con el error “The operation is insecure”.

## Compartir una vista temporal

En VS Code, con el servidor ejecutándose:

1. Abrí la vista **Ports**.
2. Seleccioná **Forward a Port**.
3. Ingresá el puerto `4173`.
4. Cambiá **Port Visibility** a **Public**.
5. Compartí la URL generada por VS Code.

El servidor y VS Code deben permanecer abiertos mientras se utiliza el enlace.

## Estructura

```text
├── index.html          Interfaz y capas de la escena
├── styles.css         Diseño del reproductor y composición
├── animation.js       Animación, partículas y análisis de audio
├── server.js          Servidor HTTP local
├── iniciar-loop.cmd   Inicio rápido para Windows
├── Imagen1.png        Imagen base de la escena
└── Imagen1.mp3        Preview musical
```

## Tecnología

- HTML5 y CSS
- Canvas 2D
- Web Audio API
- JavaScript sin dependencias externas
- Servidor HTTP de Node.js

## Próxima etapa

La arquitectura servirá como base para incorporar un selector de canciones. Cada tema podrá conservar el mismo reproductor y sistema de preview, pero tendrá una imagen, una dirección artística, efectos y un ecualizador adaptados a su propia escena.

---

Música y concepto: **Creador100k**
