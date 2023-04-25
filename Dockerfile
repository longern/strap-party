FROM zenika/alpine-chrome:112-with-node

WORKDIR /home/chrome
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV HEADLESS_CHROME 1
EXPOSE 5794
CMD ["npx", "ts-node-esm", "index.ts"]
