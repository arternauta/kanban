# Tema del Kanban

`index.html` se genera a partir de estos tres archivos:

- `base.html`  → lógica y HTML (aquí se editan los cambios de funcionamiento)
- `capa2.css`  → capa de estilos
- `theme.cjs`   → convierte colores a variables y añade la capa

Para regenerar: copiar `base.html` sobre `../index.html`, y desde esa carpeta correr
`node tema/theme.cjs` (lee y escribe `../index.html` y usa `capa2.css`).

Si prefieres dejar de usar el generador, `index.html` ya es la versión final y se puede editar directo.
