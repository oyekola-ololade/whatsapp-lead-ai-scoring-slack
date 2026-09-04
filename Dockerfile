FROM node:22-bookworm
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends apache2-utils curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install \
  && npm install n8n@2.37.9
RUN npx playwright install --with-deps chromium
COPY . .
ENV PORT=8080
CMD ["node","run-and-serve.js"]
