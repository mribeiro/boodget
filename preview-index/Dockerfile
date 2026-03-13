FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY server.js .
CMD ["node", "server.js"]
