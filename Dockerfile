FROM zenika/alpine-chrome:112-with-node

WORKDIR /home/chrome
COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5794
CMD ["npx", "ts-node", "--esm", "src/index.ts"]
