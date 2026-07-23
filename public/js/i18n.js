/**
 * i18n.js - Internationalization system for EasyLoop
 */

const I18n = {
  _locale: 'ko',
  _translations: {},
  _loaded: new Set(),
  STORAGE_KEY: 'amrLanguage',

  // Available languages (Korean only - English backup in /backup/i18n.js)
  languages: {
    ko: { name: '한국어', flag: '🇰🇷' }
  },

  /**
   * Initialize i18n system - Fixed to Korean
   */
  async init() {
    // Force Korean locale
    this._locale = 'ko';
    // B13 fix: localStorage 안전 쓰기
    try { localStorage.setItem(this.STORAGE_KEY, 'ko'); }
    catch (e) { /* ignore */ }

    await this._loadLocale('ko');
    this._applyToDOM();
  },

  /**
   * Language switching disabled - Korean only
   */
  async setLanguage() {
    // Disabled - Korean only
  },

  /**
   * Language toggle disabled - Korean only
   */
  async toggleLanguage() {
    // Disabled - Korean only
  },

  /**
   * Get current locale
   */
  getLocale() {
    return this._locale;
  },

  /**
   * Update language UI - Korean only
   * @private
   */
  _updateLanguageUI() {
    document.documentElement.lang = 'ko';
  },

  /**
   * Translate a key with optional parameter interpolation
   * @param {string} key - Translation key (supports dot notation like 'header.title')
   * @param {object} params - Optional parameters for interpolation (e.g., {name: 'John'})
   * @returns {string} Translated string
   */
  t(key, params = {}) {
    const locale = this._translations[this._locale];
    if (!locale) {
      console.warn(`Locale '${this._locale}' not loaded`);
      return key;
    }

    // Navigate through nested keys using dot notation
    const keys = key.split('.');
    let value = locale;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        console.warn(`Translation key '${key}' not found for locale '${this._locale}'`);
        return key;
      }
    }

    if (typeof value !== 'string') {
      console.warn(`Translation key '${key}' does not point to a string value`);
      return key;
    }

    // Interpolate parameters
    let result = value;
    for (const [param, paramValue] of Object.entries(params)) {
      const placeholder = `{${param}}`;
      result = result.replace(new RegExp(placeholder, 'g'), paramValue);
    }

    return result;
  },

  /**
   * Load locale translations from JSON file
   * @param {string} locale - The locale to load
   * @private
   */
  async _loadLocale(locale) {
    if (this._loaded.has(locale)) {
      return;
    }

    try {
      const response = await fetch(`/locales/${locale}.json`);
      if (!response.ok) {
        throw new Error(`Failed to load locale '${locale}': ${response.statusText}`);
      }

      const translations = await response.json();
      this._translations[locale] = translations;
      this._loaded.add(locale);
    } catch (error) {
      console.error(`Error loading locale '${locale}':`, error);
      throw error;
    }
  },

  /**
   * Apply translations to all DOM elements with i18n attributes
   * @private
   */
  _applyToDOM() {
    // Handle data-i18n attribute (sets textContent)
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(element => {
      const key = element.getAttribute('data-i18n');
      if (key) {
        element.textContent = this.t(key);
      }
    });

    // Handle data-i18n-placeholder attribute (sets placeholder)
    const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
    placeholderElements.forEach(element => {
      const key = element.getAttribute('data-i18n-placeholder');
      if (key) {
        element.placeholder = this.t(key);
      }
    });

    // Handle data-i18n-title attribute (sets title)
    const titleElements = document.querySelectorAll('[data-i18n-title]');
    titleElements.forEach(element => {
      const key = element.getAttribute('data-i18n-title');
      if (key) {
        element.title = this.t(key);
      }
    });
  }
};

// Make I18n available globally
if (typeof window !== 'undefined') {
  window.I18n = I18n;
}
