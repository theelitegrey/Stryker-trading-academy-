FROM node:22-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["node", "server.js"]
