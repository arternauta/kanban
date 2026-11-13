#!/bin/sh
# Publica SOLO la web de presentación (sitio aparte: eljoint-referencias.web.app).
# No toca el Kanban publicado. Copia la página y las fuentes al directorio público y despliega.
set -e
cd "$(dirname "$0")"
rm -rf public && mkdir -p public/fonts
cp ../presentacion.html public/presentacion.html
cp ../fonts/FreudianOne.woff ../fonts/FreudianTwo.woff \
   ../fonts/BMWMotorrad-Regular.ttf ../fonts/BMWMotorrad-Heavy.ttf ../fonts/BMWMotorradOutline-Regular.ttf \
   ../fonts/BMWTypeNext-Light.otf ../fonts/BMWTypeNext-Regular.otf ../fonts/BMWTypeNext-Bold.otf public/fonts/
python3 generar.py public # una página por marca, con su vista previa para WhatsApp
firebase deploy --only hosting --project kanbarter-a2951
