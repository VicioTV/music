# Creador100k — Night Records

Experiencia web interactiva creada para presentar canciones de **Creador100k** como composiciones audiovisuales independientes. Cada tema conserva el mismo reproductor, pero abre una escena, una paleta y un sistema de efectos propios.

[Abrir la experiencia](https://viciotv.github.io/music/)

## La colección

La entrada funciona como una pequeña colección de vinilos. Cada canción aparece como un objeto físico compuesto por una funda, un disco parcialmente expuesto y sus datos esenciales. Al seleccionar un vinilo, comienza el preview y la colección revela la composición correspondiente.

El botón **Colección** permite volver al selector y cambiar de canción sin recargar la página.

## Canción 01

### I have to go… forever

![Escena de I have to go… forever](Imagen1.png)

Una figura permanece inmóvil frente a un portal mientras el entorno entero parece ser atraído hacia él.

- Respiración y energía interna del portal.
- Ecualizador radial integrado en su borde.
- Flash ambiental activado por los graves.
- Onda expansiva en cámara superlenta.
- Partículas, polvo y descargas atraídas hacia el centro.
- Distorsión térmica y vibración del reflejo.
- Profundidad y gravedad en piedras y objetos laterales.

## Canción 02

### Perfume and Wine 壊さないで

![Escena de Perfume and Wine 壊さないで](Imagen2.png)

Dos amantes quedan separados en una estación imposible suspendida sobre la ciudad. Él se prepara para partir; ella permanece detrás del vidrio como un recuerdo.

- Lluvia animada en diferentes planos de profundidad.
- Reloj-luna convertido en ecualizador circular.
- Ondas graves desplazándose sobre las vías mojadas.
- Resplandor localizado del rayo y las nubes.
- Paleta fría que responde al audio sin perder la luz cálida del reloj.
- Movimiento atmosférico lento mientras los personajes permanecen inmóviles.

## Reproductor

Las dos composiciones comparten:

- Nombre de la canción y artista.
- Preview limitado a los primeros **1:40**.
- Reproducción y pausa.
- Barra de progreso interactiva.
- Acceso a pantalla completa desde la información de la canción.
- Análisis de audio en tiempo real mediante la Web Audio API.

Al cambiar de vinilo, el sistema detiene la canción anterior, carga el nuevo audio y activa únicamente el motor visual asociado a la composición seleccionada.

## Estructura

```text
├── index.html          Colección, reproductor y capas de las escenas
├── styles.css         Vinilos, transiciones y diseño audiovisual
├── animation.js       Escenas, partículas y análisis de audio
├── server.js          Servidor HTTP local
├── iniciar-loop.cmd   Inicio rápido para Windows
├── Imagen1.png        Composición visual 01
├── Imagen1.mp3        Preview musical 01
├── Imagen2.png        Composición visual 02
└── Imagen2.mp3        Preview musical 02
```

## Tecnología

- HTML5 y CSS
- WebGL y Canvas 2D
- Web Audio API
- JavaScript sin dependencias externas

---

Música y concepto: **Creador100k**
