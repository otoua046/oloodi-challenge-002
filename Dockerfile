FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY client client
COPY shared shared
COPY scripts/build.mjs scripts/build.mjs
COPY index.html tsconfig.json ./
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV HOST=0.0.0.0 PORT=3000
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server server
COPY shared shared
COPY scripts/reset.mjs scripts/reset.mjs
RUN mkdir data && chown node:node data
USER node
EXPOSE 3000
CMD ["node", "server/main.ts"]
