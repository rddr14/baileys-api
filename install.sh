#!/bin/bash
set -e

# Cores para o output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # Sem cor

echo -e "${BLUE}====================================================${NC}"
echo -e "${GREEN}      Instalador Automatizado - Baileys API         ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Verifica se curl, git e ffmpeg existem
echo -e "\n${BLUE}[1/5] Verificando dependências básicas do sistema...${NC}"
if ! command -v curl &> /dev/null || ! command -v git &> /dev/null || ! command -v ffmpeg &> /dev/null; then
    echo "Atualizando pacotes e instalando dependências básicas..."
    sudo apt-get update && sudo apt-get install -y curl git ffmpeg build-essential
fi

# 2. Verifica se o Node.js está instalado e é versão >= 18
echo -e "\n${BLUE}[2/5] Verificando Node.js...${NC}"
NODE_OK=0
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        NODE_OK=1
        echo -e "${GREEN}Node.js já instalado na versão $(node -v)${NC}"
    fi
fi

if [ $NODE_OK -eq 0 ]; then
    echo "Instalando Node.js 20 LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}Node.js instalado com sucesso: $(node -v)${NC}"
fi

# 3. Verifica / Instala PM2 globalmente
echo -e "\n${BLUE}[3/5] Verificando PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    echo "Instalando PM2 globalmente..."
    sudo npm install -g pm2
else
    echo -e "${GREEN}PM2 já instalado.${NC}"
fi

# 4. Configura o .env caso não exista
echo -e "\n${BLUE}[4/5] Configurando variáveis de ambiente...${NC}"
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${GREEN}Arquivo .env criado a partir de .env.example${NC}"
    fi
else
    echo -e "${GREEN}Arquivo .env já existe.${NC}"
fi

# Garante existência da pasta de uploads
mkdir -p uploads

# 5. Instala dependências do projeto
echo -e "\n${BLUE}[5/5] Instalando dependências do projeto...${NC}"
npm install --omit=dev

# Inicia ou reinicia com PM2
echo -e "\n${BLUE}Iniciando aplicação com PM2...${NC}"
pm2 start ecosystem.config.js || pm2 restart ecosystem.config.js
pm2 save

echo -e "\n${GREEN}====================================================${NC}"
echo -e "${GREEN}       Instalação Concluída com Sucesso!            ${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "A API está rodando em background."
echo -e "Para ver os logs em tempo real:  ${BLUE}pm2 logs baileys-api${NC}"
echo -e "Para ver o status do processo:   ${BLUE}pm2 status${NC}"
echo -e "Para reiniciar o serviço:       ${BLUE}pm2 restart baileys-api${NC}"
echo -e "Para parar o serviço:           ${BLUE}pm2 stop baileys-api${NC}"
echo -e "====================================================\n"

