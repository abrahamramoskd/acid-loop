# ⚡ Acid Loop — Sintetizador TB-303 en el Navegador

![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-f7df1e?style=flat-square&logo=javascript&logoColor=black)
![WebAudio](https://img.shields.io/badge/Web_Audio_API-nativo-e44d26?style=flat-square)
![CSS](https://img.shields.io/badge/CSS-puro-1572b6?style=flat-square&logo=css3&logoColor=white)
![Sin dependencias](https://img.shields.io/badge/dependencias-ninguna-2ed573?style=flat-square)
![License](https://img.shields.io/badge/licencia-MIT-6e9ef0?style=flat-square)

Sintetizador de acid house inspirado en el Roland TB-303, corriendo directamente en el navegador. Secuenciador euclidiano, filtros modulables, LFOs asignables, mezclador por pistas y visualizador de anillos en tiempo real — todo con Web Audio API puro.

## ✨ Live Demo

👉 **[Ver demo en vivo](https://abrahamramoskd.github.io/acid-loop)**

## 🎛️ Controles del sintetizador

### Transport
- **PLAY / STOP** — inicia y detiene la reproducción
- **BPM** — ajusta el tempo entre 60 y 180 pulsaciones por minuto (slider + campo numérico)

### Secuenciador euclidiano por pista
Cada pista tiene tres parámetros que definen su ritmo:

| Parámetro | Descripción |
|-----------|-------------|
| **N** | Número de pulsos activos en el patrón |
| **M** | Longitud total del patrón (4 a 32 pasos) |
| **OFF** | Desplazamiento de fase del patrón |

### Parámetros 303
Cinco parámetros clásicos del TB-303, cada uno con control manual y LFO asignable:

| Parámetro | Rango | Descripción |
|-----------|-------|-------------|
| **Random** | 0–100 | Aleatoriedad en las notas generadas |
| **Resonance** | 0–100 | Resonancia del filtro |
| **Cutoff** | 0–100 | Frecuencia de corte del filtro paso bajo |
| **Env Mod** | 0–100 | Modulación de la envolvente sobre el filtro |
| **Distortion** | 0–100 | Saturación y distorsión de la señal |

### LFOs asignables
Cada parámetro 303 tiene su propio LFO independiente con:
- **Forma de onda** — SIN, TRI, SAW, SQU, RND (aleatoria)
- **Duración** — de 4 a 256 pasos

### Mezclador
- Fader vertical por pista (0–100)
- Botón de mute individual por pista
- Fader master para el volumen general

### Visualizador
- Anillos SVG animados en tiempo real sincronizados con la reproducción

## 🛠️ Tecnologías

- **Web Audio API** — síntesis de sonido, filtros y osciladores en el navegador
- **JavaScript vanilla** — secuenciador euclidiano, LFOs y lógica de modulación
- **SVG** — visualizador de anillos animado
- **HTML + CSS puro** — interfaz sin frameworks

## 📁 Estructura

```
acid-loop/
├── index.html    ← Estructura de la UI y templates
├── script.js     ← Motor de audio, secuenciador y lógica
└── style.css     ← Estilos de la interfaz
```

## 🚀 Uso

Abre `index.html` en cualquier navegador moderno. Pulsa **PLAY**, ajusta el BPM y experimenta con los parámetros del filtro y los LFOs para generar patrones de acid.

> El navegador puede pedir permiso para reproducir audio — acepta para activar el motor de sonido.

## 📄 Licencia

MIT — úsalo en lo que quieras, personal o comercial.

---

Hecho con ❤️ por [abrahamramoskd](https://github.com/abrahamramoskd)  
Si te fue útil, dale una ⭐ al repo!
