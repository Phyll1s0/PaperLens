FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ocrmypdf \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-chi-sim \
    tesseract-ocr-eng \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --package-lock=false
RUN npm config set os linux \
  && npm install -g @anthropic-ai/claude-code --force

COPY . .

RUN mkdir -p uploads data paper-assets .cache \
  && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV PAPERLENS_PDF_ENGINE=poppler

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node scripts/healthcheck.mjs

ENTRYPOINT ["tini", "--"]
CMD ["npm", "start"]
