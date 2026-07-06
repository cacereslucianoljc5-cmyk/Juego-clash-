# ⚔️ Clash 3D — Batalla en la Arena

Juego web 3D estilo Clash Royale hecho con [three.js](https://threejs.org).
Usa los 12 modelos 3D del repo [Clash3deee](https://github.com/cacereslucianoljc5-cmyk/clash3deee),
**optimizados para la web** (de ~220 MB a ~13 MB en total: simplificación de malla,
cuantización y texturas WebP con `gltf-transform`).

## Cómo jugar

- Junta **elixir** (se regenera solo) y elige una carta del mazo.
- Toca **tu mitad de la arena** (la de abajo) para desplegar la unidad.
- Las tropas avanzan solas, **cruzan el río por los puentes** y atacan lo que
  encuentren. Destruye la **Torre del Rey** rival antes de que acabe el tiempo.

## Características

| | |
|---|---|
| 🗺️ **Arena** | El modelo `Arena.glb` es el mapa (sin animación propia). |
| 🌊 **Agua animada** | Un plano ondulante con olas cubre el río y los canales. |
| 🚧 **Colisiones** | Cuadrícula transitable horneada del propio modelo: el agua y los bordes del campo (antes de los bosques) bloquean el paso; el río solo se cruza por los dos puentes. |
| 🏃 **Animación de caminar** | Esqueleto, Bárbaro, Arquero, Bombardero, Mago, Gigante y P.E.K.K.A (rebote + balanceo); Montapuercos galopa. |
| ⚔️ **Animación de ataque** | Embestida (cuerpo a cuerpo), arco (Arquero), conjuro (Mago), lanzamiento (Bombardero) y culatazo (Cañón). |
| 🏰 **Torres fijas** | Las torres no se mueven al disparar, como en Clash; en la Torre del Rey solo gira el cañón (separado en un nodo `Turret` propio) para apuntar a los enemigos. |
| 💀 **Muerte** | Las unidades caen y se hunden. |
| 🧠 **Rival con IA** | Junta elixir y despliega oleadas en su mitad. |

Como todos los modelos carecen de esqueleto, las animaciones son
**procedurales** (movimiento del cuerpo completo por código, en `js/units.js`).

## Ejecutar en local

Usa módulos ES y carga `.glb`, así que hay que servirlo por HTTP:

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

O actívalo en **GitHub Pages**: el workflow publica la rama en `gh-pages`
automáticamente (Settings → Pages → rama `gh-pages`).

## Librerías (todas de GitHub, servidas en local)

- [three.js](https://github.com/mrdoob/three) r160 (MIT) — motor 3D (WebGL).
- [TypeGPU](https://github.com/software-mansion/TypeGPU) 0.11 (MIT) — post-procesado WebGPU (bloom, color, viñeta).
- [ZzFX](https://github.com/KilledByAPixel/ZzFX) (MIT) — todos los sonidos se sintetizan por código: hover, clics, despliegue, ataques, explosiones y jingles de final.
- [Lucide](https://github.com/lucide-icons/lucide) (ISC) — iconos SVG minimalistas para cartas, coronas, resultado, favicon y el cursor. **El juego no usa ningún emoji.**

El cursor es una mano custom (iconos Lucide): abierta sobre la arena, señalando
al pasar por una carta y agarrando mientras mantienes pulsado. En pantallas
táctiles se usa el control nativo.

## Estructura

```
index.html          interfaz y arranque
js/game.js          bucle del juego, combate, IA, agua animada y colisiones
js/units.js         catálogo de unidades y animaciones procedurales
js/arenadata.js     cuadrícula transitable horneada de Arena.glb
models/*.glb        los 12 modelos optimizados (Clash3deee)
lib/                three.js r160 + GLTFLoader
```
