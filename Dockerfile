FROM node:20-bullseye-slim

# Instala dependências básicas do sistema (ffmpeg para manipulação de áudio/mídia, curl, git)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia manifestos de pacotes primeiro para aproveitar o cache do Docker
COPY package*.json ./

RUN npm install --omit=dev

# Copia o restante do código da aplicação
COPY . .

# Cria pasta de uploads caso não exista
RUN mkdir -p uploads

EXPOSE 3000

CMD ["npm", "start"]

