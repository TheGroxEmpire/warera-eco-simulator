FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/index.html
COPY styles.css /usr/share/nginx/html/styles.css
COPY app.js /usr/share/nginx/html/app.js
COPY images /usr/share/nginx/html/images
RUN mkdir -p /usr/share/nginx/html/eco-simulator
COPY index.html /usr/share/nginx/html/eco-simulator/index.html
COPY styles.css /usr/share/nginx/html/eco-simulator/styles.css
COPY app.js /usr/share/nginx/html/eco-simulator/app.js
COPY images /usr/share/nginx/html/eco-simulator/images

EXPOSE 80
