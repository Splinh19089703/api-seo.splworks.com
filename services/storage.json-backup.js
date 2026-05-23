const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const DATA_DIR = path.join(__dirname, "..", "data");

class Storage {
  constructor() {
    fs.ensureDirSync(DATA_DIR);
  }

  _getFilePath(collection) {
    return path.join(DATA_DIR, `${collection}.json`);
  }

  async getAll(collection) {
    const filePath = this._getFilePath(collection);
    if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
    }
    return [];
  }

  async getById(collection, id) {
    const items = await this.getAll(collection);
    return items.find((item) => item.id === id) || null;
  }

  async create(collection, data) {
    const items = await this.getAll(collection);
    const newItem = {
      id: uuidv4(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    items.push(newItem);
    await fs.writeJson(this._getFilePath(collection), items, { spaces: 2 });
    return newItem;
  }

  async update(collection, id, data) {
    const items = await this.getAll(collection);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    items[index] = {
      ...items[index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeJson(this._getFilePath(collection), items, { spaces: 2 });
    return items[index];
  }

  async delete(collection, id) {
    const items = await this.getAll(collection);
    const filtered = items.filter((item) => item.id !== id);
    await fs.writeJson(this._getFilePath(collection), filtered, { spaces: 2 });
    return filtered.length < items.length;
  }

  // Settings (key-value store)
  async getSettings() {
    const filePath = path.join(DATA_DIR, "settings.json");
    if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
    }
    return this._defaultSettings();
  }

  async saveSettings(settings) {
    const filePath = path.join(DATA_DIR, "settings.json");
    await fs.writeJson(filePath, settings, { spaces: 2 });
    return settings;
  }

  _defaultSettings() {
    return {
      theme: "dark",
      aiProvider: {
        mode: "gemini",
        fallbackOrder: "gemini",
        gemini: {
          textModel: "gemini-2.5-flash",
          imageModel: "gemini-2.5-flash",
          timeout: 60,
        },
        openai: {
          textModel: "gpt-4o-mini",
          imageModel: "dall-e-3",
          timeout: 120,
        },
        openrouter: {
          textModel: "google/gemini-2.5-flash",
          imageModel: "",
          timeout: 120,
        },
      },
      processing: { batchSize: 5, maxRetries: 3, stuckTimeout: 30 },
      queue: { ai: 1, youtube: 2, media: 3, publishing: 2 },
    };
  }
}

module.exports = new Storage();
