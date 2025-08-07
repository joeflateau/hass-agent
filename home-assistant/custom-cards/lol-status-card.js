const LitElement = customElements.get("hui-masonry-view")
  ? Object.getPrototypeOf(customElements.get("hui-masonry-view"))
  : Object.getPrototypeOf(customElements.get("hui-view"));
const html = LitElement.prototype.html || LitElement.html;
const css = LitElement.prototype.css || LitElement.css;

class LoLStatusCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: { state: true },
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("You need to define an entity");
    }
    this.config = config;
  }

  render() {
    if (!this.hass || !this.config) {
      return html``;
    }

    const entityId = this.config.entity;
    const stateObj = this.hass.states[entityId];

    if (!stateObj) {
      return html`
        <ha-card>
          <div class="card-content">
            <div class="error">Entity ${entityId} not found</div>
          </div>
        </ha-card>
      `;
    }

    const attributes = stateObj.attributes;
    const isInGame = attributes.isInGame || false;
    const gameMode = attributes.gameMode || "N/A";
    const gameTime = attributes.gameTime
      ? Math.floor(attributes.gameTime / 60)
      : null;
    const championName = attributes.championName || "N/A";
    const level = attributes.level || "N/A";
    const currentGold = attributes.currentGold || 0;
    const score = attributes.score || { kills: 0, deaths: 0, assists: 0 };
    const mapName = attributes.mapName || "N/A";
    const summonerSpells = attributes.summonerSpells || {};
    const items = attributes.items || [];

    const cardTitle = this.config.title || "League of Legends Status";
    const showHeader = this.config.show_header !== false; // Default to true

    return html`
      <ha-card>
        ${showHeader
          ? html`
              <div class="card-header">
                <ha-icon icon="mdi:gamepad-variant"></ha-icon>
                <h2 class="card-title">${cardTitle}</h2>
              </div>
            `
          : ""}

        <div
          class="status-indicator ${isInGame
            ? "status-online"
            : "status-offline"}"
        >
          <ha-icon
            icon="${isInGame ? "mdi:play-circle" : "mdi:stop-circle"}"
          ></ha-icon>
          ${isInGame ? "In Game" : "Not Playing"}
        </div>

        ${isInGame
          ? html`
              <div class="game-info">
                <div class="info-item">
                  <div class="info-label">Game Mode</div>
                  <div class="info-value">${gameMode}</div>
                </div>
                <div class="info-item">
                  <div class="info-label">Map</div>
                  <div class="info-value">${mapName}</div>
                </div>
              </div>

              ${gameTime !== null
                ? html`
                    <div class="game-time">
                      Game Time:
                      ${gameTime}:${String(
                        Math.floor(attributes.gameTime % 60)
                      ).padStart(2, "0")}
                    </div>
                  `
                : ""}
              ${championName !== "N/A"
                ? html`
                    <div class="champion-info">
                      <div class="champion-name">${championName}</div>
                      <div class="champion-level">Level ${level}</div>
                    </div>
                  `
                : ""}
              ${summonerSpells.summonerSpellOne ||
              summonerSpells.summonerSpellTwo
                ? html`
                    <div class="summoner-spells">
                      <div class="section-title">Summoner Spells</div>
                      <div class="spells-container">
                        ${summonerSpells.summonerSpellOne
                          ? html`
                              <div class="spell-item">
                                <div class="spell-name">
                                  ${summonerSpells.summonerSpellOne.displayName}
                                </div>
                              </div>
                            `
                          : ""}
                        ${summonerSpells.summonerSpellTwo
                          ? html`
                              <div class="spell-item">
                                <div class="spell-name">
                                  ${summonerSpells.summonerSpellTwo.displayName}
                                </div>
                              </div>
                            `
                          : ""}
                      </div>
                    </div>
                  `
                : ""}
              ${currentGold > 0
                ? html`
                    <div class="gold-info">
                      <ha-icon
                        class="gold-icon"
                        icon="mdi:currency-usd"
                      ></ha-icon>
                      <span class="gold-amount"
                        >${currentGold.toLocaleString()}g</span
                      >
                    </div>
                  `
                : ""}
              ${score.kills !== null &&
              score.deaths !== null &&
              score.assists !== null
                ? html`
                    <div class="score-section">
                      <div class="score-item">
                        <div class="score-number kills">${score.kills}</div>
                        <div class="score-label">Kills</div>
                      </div>
                      <div class="score-item">
                        <div class="score-number deaths">${score.deaths}</div>
                        <div class="score-label">Deaths</div>
                      </div>
                      <div class="score-item">
                        <div class="score-number assists">${score.assists}</div>
                        <div class="score-label">Assists</div>
                      </div>
                    </div>
                  `
                : ""}
              ${items.length > 0
                ? html`
                    <div class="items-section">
                      <div class="section-title">Items</div>
                      <div class="items-grid">
                        ${items.map(
                          (item) => html`
                            <div
                              class="item-slot"
                              title="${item.rawDescription}"
                            >
                              <div class="item-name">${item.displayName}</div>
                              ${item.count > 1
                                ? html`<div class="item-count">
                                    x${item.count}
                                  </div>`
                                : ""}
                            </div>
                          `
                        )}
                        ${Array.from({
                          length: Math.max(0, 6 - items.length),
                        }).map(() => html`<div class="item-slot empty"></div>`)}
                      </div>
                    </div>
                  `
                : ""}
            `
          : html`
              <div class="offline-message">
                Start a League of Legends game to see live stats
              </div>
            `}
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      ha-card {
        padding: 16px;
      }
      .card-header {
        display: flex;
        align-items: center;
        margin-bottom: 16px;
      }
      .card-header ha-icon {
        margin-right: 8px;
        color: var(--primary-color);
      }
      .card-title {
        font-size: 1.2em;
        font-weight: 500;
        margin: 0;
      }
      .status-indicator {
        display: flex;
        align-items: center;
        margin-bottom: 16px;
        padding: 8px 12px;
        border-radius: 8px;
        font-weight: 500;
      }
      .status-online {
        background-color: rgba(76, 175, 80, 0.1);
        color: #4caf50;
        border: 1px solid rgba(76, 175, 80, 0.3);
      }
      .status-offline {
        background-color: rgba(158, 158, 158, 0.1);
        color: #9e9e9e;
        border: 1px solid rgba(158, 158, 158, 0.3);
      }
      .status-indicator ha-icon {
        margin-right: 8px;
      }
      .game-info {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        margin-bottom: 16px;
      }
      .info-item {
        display: flex;
        flex-direction: column;
      }
      .info-label {
        font-size: 0.8em;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
        text-transform: uppercase;
        font-weight: 500;
      }
      .info-value {
        font-size: 1.1em;
        font-weight: 500;
        color: var(--primary-text-color);
      }
      .champion-info {
        text-align: center;
        margin-bottom: 16px;
        padding: 12px;
        background-color: var(--card-background-color);
        border-radius: 8px;
        border: 1px solid var(--divider-color);
      }
      .champion-name {
        font-size: 1.3em;
        font-weight: bold;
        color: var(--primary-color);
        margin-bottom: 4px;
      }
      .champion-level {
        color: var(--secondary-text-color);
      }
      .score-section {
        display: flex;
        justify-content: space-around;
        padding: 12px;
        background-color: var(--card-background-color);
        border-radius: 8px;
        border: 1px solid var(--divider-color);
      }
      .score-item {
        text-align: center;
        flex: 1;
      }
      .score-number {
        font-size: 1.5em;
        font-weight: bold;
        margin-bottom: 4px;
      }
      .score-label {
        font-size: 0.8em;
        color: var(--secondary-text-color);
        text-transform: uppercase;
      }
      .kills {
        color: #4caf50;
      }
      .deaths {
        color: #f44336;
      }
      .assists {
        color: #2196f3;
      }
      .gold-info {
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 16px 0;
        padding: 8px;
        background-color: rgba(255, 193, 7, 0.1);
        border-radius: 8px;
        border: 1px solid rgba(255, 193, 7, 0.3);
      }
      .gold-icon {
        color: #ffc107;
        margin-right: 8px;
      }
      .gold-amount {
        font-size: 1.2em;
        font-weight: bold;
        color: #ffc107;
      }
      .game-time {
        text-align: center;
        font-size: 1.1em;
        color: var(--primary-color);
        font-weight: 500;
      }
      .offline-message {
        text-align: center;
        color: var(--secondary-text-color);
        font-style: italic;
        margin: 16px 0;
      }
      .error {
        color: var(--error-color);
        text-align: center;
        padding: 16px;
      }
      .section-title {
        font-size: 0.9em;
        font-weight: 600;
        color: var(--primary-text-color);
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .summoner-spells {
        margin-bottom: 16px;
        padding: 12px;
        background-color: var(--card-background-color);
        border-radius: 8px;
        border: 1px solid var(--divider-color);
      }
      .spells-container {
        display: flex;
        gap: 12px;
        justify-content: center;
      }
      .spell-item {
        flex: 1;
        text-align: center;
        padding: 8px;
        background-color: rgba(103, 58, 183, 0.1);
        border-radius: 6px;
        border: 1px solid rgba(103, 58, 183, 0.3);
      }
      .spell-name {
        font-size: 0.9em;
        font-weight: 500;
        color: #673ab7;
      }
      .items-section {
        margin-bottom: 16px;
        padding: 12px;
        background-color: var(--card-background-color);
        border-radius: 8px;
        border: 1px solid var(--divider-color);
      }
      .items-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
      }
      .item-slot {
        aspect-ratio: 1;
        border-radius: 6px;
        border: 2px solid var(--divider-color);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 4px;
        text-align: center;
        position: relative;
        background-color: var(--primary-background-color);
        transition: all 0.2s ease;
      }
      .item-slot:hover {
        border-color: var(--primary-color);
        transform: translateY(-2px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      }
      .item-slot.empty {
        background-color: var(--disabled-color);
        opacity: 0.3;
      }
      .item-slot.empty:hover {
        transform: none;
        box-shadow: none;
        border-color: var(--divider-color);
      }
      .item-name {
        font-size: 0.7em;
        font-weight: 500;
        color: var(--primary-text-color);
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .item-count {
        position: absolute;
        bottom: 2px;
        right: 2px;
        background-color: var(--primary-color);
        color: white;
        font-size: 0.6em;
        font-weight: bold;
        padding: 1px 4px;
        border-radius: 3px;
        min-width: 12px;
        text-align: center;
      }
    `;
  }

  getCardSize() {
    return 4;
  }

  static getConfigElement() {
    return document.createElement("lol-status-card-editor");
  }

  static getStubConfig() {
    return {
      entity: "sensor.your_device_lol_game_info",
      title: "League of Legends Status",
      show_header: true,
    };
  }
}

// Config editor for the card
class LoLStatusCardEditor extends LitElement {
  static get properties() {
    return {
      hass: {},
      _config: { state: true },
    };
  }

  setConfig(config) {
    this._config = { ...config };
  }

  get _entity() {
    return this._config?.entity || "";
  }

  get _title() {
    return this._config?.title || "";
  }

  get _show_header() {
    return this._config?.show_header !== false;
  }

  render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    return html`
      <div class="card-config">
        <ha-entity-picker
          .hass=${this.hass}
          .value=${this._entity}
          .configValue=${"entity"}
          @value-changed=${this._valueChanged}
          .label=${"Entity (Required)"}
          .required=${true}
          .helper=${"Select the LoL status sensor entity"}
        ></ha-entity-picker>

        <ha-textfield
          .value=${this._title}
          .configValue=${"title"}
          @input=${this._valueChanged}
          .label=${"Title"}
          .helper=${"Custom title for the card"}
        ></ha-textfield>

        <ha-formfield .label=${"Show Header"}>
          <ha-switch
            .checked=${this._show_header}
            .configValue=${"show_header"}
            @change=${this._valueChanged}
          ></ha-switch>
        </ha-formfield>
      </div>
    `;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) {
      return;
    }
    const target = ev.target;
    const configValue = target.configValue;

    if (!configValue) {
      return;
    }

    let value;
    if (target.type === "checkbox" || target.type === "switch") {
      value = target.checked;
    } else {
      value = target.value;
    }

    if (this._config[configValue] === value) {
      return;
    }

    const newConfig = {
      ...this._config,
      [configValue]: value,
    };

    this._config = newConfig;

    const event = new CustomEvent("config-changed", {
      detail: { config: newConfig },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  static get styles() {
    return css`
      .card-config {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      ha-entity-picker,
      ha-textfield {
        width: 100%;
      }

      ha-formfield {
        display: flex;
        align-items: center;
        padding: 8px 0;
      }
    `;
  }
}

customElements.define("lol-status-card", LoLStatusCard);
customElements.define("lol-status-card-editor", LoLStatusCardEditor);

// Add to custom card registry
window.customCards = window.customCards || [];
window.customCards.push({
  type: "lol-status-card",
  name: "LoL Status Card",
  description: "A custom card to display League of Legends game status",
  preview: true,
  documentationURL: "https://github.com/your-repo/lol-status-card",
});
