# Uses Microsoft's official Playwright image — Chromium is already installed
# No install step needed, build is fast
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

WORKDIR /app

# Copy package files and install only our dependencies (not Playwright browsers - already in image)
COPY package.json ./
RUN npm install --omit=dev

# Copy the scraper
COPY pax-scraper.js ./

# Expose port
EXPOSE 3000

# Start
CMD ["node", "pax-scraper.js", "--server"]
