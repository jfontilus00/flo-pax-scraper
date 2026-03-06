FROM mcr.microsoft.com/playwright:v1.57.0-jammy
WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

EXPOSE 3000
CMD ["node", "server.js"]
