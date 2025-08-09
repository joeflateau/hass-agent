const LitElement = customElements.get("hui-masonry-view")
  ? Object.getPrototypeOf(customElements.get("hui-masonry-view"))
  : Object.getPrototypeOf(customElements.get("hui-view"));
const html = LitElement.prototype.html || LitElement.html;
const css = LitElement.prototype.css || LitElement.css;

// Main card
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
    const championImageUrl = attributes.championImageUrl || null;
    const skinName = attributes.skinName || null;
    const level = attributes.level || "N/A";
    const currentGold = attributes.currentGold || 0;
    const score = attributes.score || {
      kills: 0,
      deaths: 0,
      assists: 0,
      creepScore: 0,
      wardScore: 0,
    };
    const mapName = attributes.mapName || "N/A";
    const position = attributes.position || null;
    const team = attributes.team || null;
    const isDead = attributes.isDead || false;
    const respawnTimer = attributes.respawnTimer || 0;
    const summonerSpells = attributes.summonerSpells || {};
    const items = attributes.items || [];
    const abilities = attributes.abilities || {};
    const runes = attributes.runes || null;
    const teammates = attributes.teammates || [];
    const enemies = attributes.enemies || [];

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
              ${score.kills !== null &&
              score.deaths !== null &&
              score.assists !== null
                ? html`
                    <div class="score-section">
                      <div class="score-item">
                        <div class="score-number kills">${score.kills}</div>
                        <div class="score-label">Kills</div>
                      </div>
                      <div class="score-separator">/</div>
                      <div class="score-item">
                        <div class="score-number deaths">${score.deaths}</div>
                        <div class="score-label">Deaths</div>
                      </div>
                      <div class="score-separator">/</div>
                      <div class="score-item">
                        <div class="score-number assists">${score.assists}</div>
                        <div class="score-label">Assists</div>
                      </div>
                      ${score.creepScore !== undefined
                        ? html`
                            <div class="score-divider"></div>
                            <div class="score-item">
                              <div class="score-number cs">
                                ${score.creepScore}
                              </div>
                              <div class="score-label">CS</div>
                            </div>
                          `
                        : ""}
                      ${score.wardScore !== undefined
                        ? html`
                            <div class="score-item">
                              <div class="score-number wards">
                                ${Math.floor(score.wardScore)}
                              </div>
                              <div class="score-label">Wards</div>
                            </div>
                          `
                        : ""}
                    </div>
                  `
                : ""}
              ${championName !== "N/A"
                ? html`
                    <div class="champion-info">
                      ${championImageUrl
                        ? html`
                            <div class="champion-image">
                              <img
                                src="${championImageUrl}"
                                alt="${championName}"
                                title="${championName}"
                              />
                            </div>
                          `
                        : ""}
                      <div class="champion-details-text">
                        <div class="champion-name">${championName}</div>
                        ${skinName
                          ? html`<div class="skin-name">${skinName}</div>`
                          : ""}
                        <div class="champion-details">
                          <span class="champion-level">Level ${level}</span>
                          ${position
                            ? html`<span class="position">${position}</span>`
                            : ""}
                          ${team ? html`<span class="team">${team}</span>` : ""}
                        </div>
                        ${isDead
                          ? html`<div class="death-timer">
                              💀 Respawn: ${Math.floor(respawnTimer)}s
                            </div>`
                          : ""}
                      </div>
                    </div>
                  `
                : ""}
              ${summonerSpells.summonerSpellOne ||
              summonerSpells.summonerSpellTwo
                ? html`
                    <div class="summoner-spells">
                      <div class="spells-container">
                        ${summonerSpells.summonerSpellOne
                          ? html`
                              <div class="spell-item">
                                ${summonerSpells.summonerSpellOne.imageUrl
                                  ? html`
                                      <div class="spell-image">
                                        <img
                                          src="${summonerSpells.summonerSpellOne
                                            .imageUrl}"
                                          alt="${summonerSpells.summonerSpellOne
                                            .displayName}"
                                          title="${summonerSpells
                                            .summonerSpellOne.displayName}"
                                        />
                                      </div>
                                    `
                                  : ""}
                                <div class="spell-key">D</div>
                                <div class="spell-info">
                                  <div class="spell-name">
                                    ${summonerSpells.summonerSpellOne
                                      .displayName}
                                  </div>
                                </div>
                              </div>
                            `
                          : html`<div class="spell-item empty"></div>`}
                        ${summonerSpells.summonerSpellTwo
                          ? html`
                              <div class="spell-item">
                                ${summonerSpells.summonerSpellTwo.imageUrl
                                  ? html`
                                      <div class="spell-image">
                                        <img
                                          src="${summonerSpells.summonerSpellTwo
                                            .imageUrl}"
                                          alt="${summonerSpells.summonerSpellTwo
                                            .displayName}"
                                          title="${summonerSpells
                                            .summonerSpellTwo.displayName}"
                                        />
                                      </div>
                                    `
                                  : ""}
                                <div class="spell-key">F</div>
                                <div class="spell-info">
                                  <div class="spell-name">
                                    ${summonerSpells.summonerSpellTwo
                                      .displayName}
                                  </div>
                                </div>
                              </div>
                            `
                          : html`<div class="spell-item empty"></div>`}
                      </div>
                    </div>
                  `
                : ""}
              ${abilities.Q ||
              abilities.W ||
              abilities.E ||
              abilities.R ||
              abilities.Passive
                ? html`
                    <div class="abilities-section">
                      <div class="abilities-container">
                        <lol-ability-item
                          .ability=${abilities.Passive}
                          .keyName=${"P"}
                          .isEmpty=${!abilities.Passive}
                        ></lol-ability-item>
                        <lol-ability-item
                          .ability=${abilities.Q}
                          .keyName=${"Q"}
                          .isEmpty=${!abilities.Q}
                        ></lol-ability-item>
                        <lol-ability-item
                          .ability=${abilities.W}
                          .keyName=${"W"}
                          .isEmpty=${!abilities.W}
                        ></lol-ability-item>
                        <lol-ability-item
                          .ability=${abilities.E}
                          .keyName=${"E"}
                          .isEmpty=${!abilities.E}
                        ></lol-ability-item>
                        <lol-ability-item
                          .ability=${abilities.R}
                          .keyName=${"R"}
                          .isEmpty=${!abilities.R}
                        ></lol-ability-item>
                      </div>
                    </div>
                  `
                : ""}
              ${runes
                ? html`
                    <div class="runes-section">
                      <div class="runes-container">
                        <div class="keystone-rune">
                          <div class="rune-type">Keystone</div>
                          <div class="rune-name">
                            ${runes.keystone.displayName}
                          </div>
                        </div>
                        <div class="rune-trees">
                          <div class="rune-tree">
                            <div class="rune-type">Primary</div>
                            <div class="rune-name">
                              ${runes.primaryRuneTree.displayName}
                            </div>
                          </div>
                          <div class="rune-tree">
                            <div class="rune-type">Secondary</div>
                            <div class="rune-name">
                              ${runes.secondaryRuneTree.displayName}
                            </div>
                          </div>
                        </div>
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
                        >${Math.floor(currentGold).toLocaleString()}g</span
                      >
                    </div>
                  `
                : ""}
              ${items.length > 0 || true
                ? html`
                    <div class="items-section">
                      <div class="items-grid">
                        ${(() => {
                          // Create array for 7 slots (6 items + 1 trinket)
                          const itemSlots = new Array(7).fill(null);

                          // Place items in their correct slots
                          items.forEach((item) => {
                            itemSlots[item.slot] = item;
                          });

                          return itemSlots.map((item, index) => {
                            const isTrinket = index === 6;
                            return html`
                              <lol-item-slot
                                .item=${item}
                                .isTrinket=${isTrinket}
                                .isEmpty=${!item}
                              ></lol-item-slot>
                            `;
                          });
                        })()}
                      </div>
                    </div>
                  `
                : ""}
              ${teammates.length > 0 || enemies.length > 0
                ? html`
                    <div class="players-section">
                      ${teammates.length > 0
                        ? html`
                            <lol-team-section
                              .players=${teammates}
                              .teamType=${"teammates"}
                              .title=${"Team"}
                            ></lol-team-section>
                          `
                        : ""}
                      ${enemies.length > 0
                        ? html`
                            <lol-team-section
                              .players=${enemies}
                              .teamType=${"enemies"}
                              .title=${"Enemies"}
                            ></lol-team-section>
                          `
                        : ""}
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
        padding: 12px;
      }
      .card-header {
        display: flex;
        align-items: center;
        margin-bottom: 12px;
      }
      .card-header ha-icon {
        margin-right: 6px;
        color: var(--primary-color);
      }
      .card-title {
        font-size: 1.1em;
        font-weight: 500;
        margin: 0;
      }
      .status-indicator {
        display: flex;
        align-items: center;
        margin-bottom: 12px;
        padding: 6px 10px;
        border-radius: 6px;
        font-weight: 500;
        font-size: 0.9em;
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
        margin-right: 6px;
      }
      .game-info {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-bottom: 12px;
      }
      .info-item {
        display: flex;
        flex-direction: column;
      }
      .info-label {
        font-size: 0.7em;
        color: var(--secondary-text-color);
        margin-bottom: 2px;
        text-transform: uppercase;
        font-weight: 500;
      }
      .info-value {
        font-size: 1em;
        font-weight: 500;
        color: var(--primary-text-color);
      }
      .champion-info {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
        padding: 8px;
        background-color: var(--card-background-color);
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .champion-image {
        flex-shrink: 0;
      }
      .champion-image img {
        width: 48px;
        height: 48px;
        border-radius: 6px;
        object-fit: cover;
        border: 2px solid var(--primary-color);
      }
      .champion-details-text {
        flex: 1;
      }
      .champion-name {
        font-size: 1.2em;
        font-weight: bold;
        color: var(--primary-color);
        margin-bottom: 2px;
      }
      .skin-name {
        font-size: 0.8em;
        color: var(--secondary-text-color);
        font-style: italic;
        margin-bottom: 4px;
      }
      .champion-details {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .champion-level {
        color: var(--secondary-text-color);
        font-size: 0.85em;
      }
      .position {
        background-color: var(--primary-color);
        color: white;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 0.7em;
        font-weight: 500;
        text-transform: uppercase;
      }
      .team {
        background-color: var(--accent-color, #ff9800);
        color: white;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 0.7em;
        font-weight: 500;
      }
      .death-timer {
        margin-top: 6px;
        padding: 3px 6px;
        background-color: rgba(244, 67, 54, 0.1);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: 4px;
        color: #f44336;
        font-weight: 500;
        font-size: 0.8em;
        text-align: center;
      }
      .score-section {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        margin: 10px 0;
        padding: 8px;
        background-color: var(--card-background-color);
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .score-item {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .score-separator {
        font-size: 1.1em;
        font-weight: bold;
        color: var(--secondary-text-color);
        margin: 0 3px;
      }
      .score-divider {
        width: 1px;
        height: 32px;
        background-color: var(--divider-color);
        margin: 0 8px;
      }
      .score-number {
        font-size: 1.2em;
        font-weight: bold;
        margin-bottom: 1px;
      }
      .score-label {
        font-size: 0.6em;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        font-weight: 500;
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
      .cs {
        color: #ff9800;
      }
      .wards {
        color: #9c27b0;
      }
      .gold-info {
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 10px 0;
        padding: 6px;
        background-color: rgba(255, 193, 7, 0.1);
        border-radius: 6px;
        border: 1px solid rgba(255, 193, 7, 0.3);
      }
      .gold-icon {
        color: #ffc107;
        margin-right: 6px;
      }
      .gold-amount {
        font-size: 1.1em;
        font-weight: bold;
        color: #ffc107;
      }
      .game-time {
        text-align: center;
        font-size: 1em;
        color: var(--primary-color);
        font-weight: 500;
        margin-bottom: 8px;
      }
      .offline-message {
        text-align: center;
        color: var(--secondary-text-color);
        font-style: italic;
        margin: 12px 0;
        font-size: 0.9em;
      }
      .error {
        color: var(--error-color);
        text-align: center;
        padding: 12px;
      }
      .summoner-spells {
        margin-bottom: 12px;
        padding: 8px;
        background-color: var(--card-background-color);
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .spells-container {
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      .spell-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 6px 4px;
        background-color: rgba(103, 58, 183, 0.1);
        border-radius: 4px;
        border: 1px solid rgba(103, 58, 183, 0.3);
        min-height: 50px;
      }
      .spell-item.empty {
        background-color: var(--disabled-color);
        opacity: 0.3;
        border-color: var(--divider-color);
      }
      .spell-image {
        margin-bottom: 2px;
      }
      .spell-image img {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        object-fit: cover;
        border: 1px solid rgba(103, 58, 183, 0.5);
      }
      .spell-key {
        background-color: #673ab7;
        color: white;
        font-weight: bold;
        font-size: 0.8em;
        padding: 4px 6px;
        border-radius: 3px;
        min-width: 20px;
        text-align: center;
      }
      .spell-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
      }
      .spell-name {
        font-size: 0.6em;
        font-weight: 500;
        color: var(--primary-text-color);
        line-height: 1.1;
        text-align: center;
      }
      .abilities-section {
        margin-bottom: 12px;
        padding: 8px;
        background-color: var(--card-background-color);
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .abilities-container {
        display: flex;
        gap: 6px;
        justify-content: space-between;
      }
      .items-section {
        margin-bottom: 12px;
        padding: 8px;
        background-color: var(--card-background-color);
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .items-grid {
        display: grid;
        grid-template-columns: repeat(6, 1fr) 0.8fr;
        gap: 4px;
        align-items: center;
      }
      .runes-section {
        margin-bottom: 12px;
        padding: 8px;
        background-color: var(--card-background-color);
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .runes-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .keystone-rune {
        text-align: center;
        padding: 6px;
        background-color: rgba(255, 193, 7, 0.1);
        border: 1px solid rgba(255, 193, 7, 0.3);
        border-radius: 4px;
      }
      .rune-trees {
        display: flex;
        gap: 6px;
      }
      .rune-tree {
        flex: 1;
        text-align: center;
        padding: 4px;
        background-color: rgba(156, 39, 176, 0.1);
        border: 1px solid rgba(156, 39, 176, 0.3);
        border-radius: 4px;
      }
      .rune-type {
        font-size: 0.6em;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        font-weight: 500;
        margin-bottom: 1px;
      }
      .rune-name {
        font-size: 0.7em;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      /* Players section styles */
      .players-section {
        margin-bottom: 12px;
      }
    `;
  }

  getCardSize() {
    return 5;
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

// Item Slot Component
class ItemSlot extends LitElement {
  static get properties() {
    return {
      item: { type: Object },
      isTrinket: { type: Boolean },
      isEmpty: { type: Boolean },
    };
  }

  render() {
    if (this.isEmpty || !this.item) {
      return html`
        <div class="item-slot empty ${this.isTrinket ? "trinket" : ""}"></div>
      `;
    }

    return html`
      <div
        class="item-slot ${this.isTrinket ? "trinket" : ""}"
        title="${this.item.rawDescription || this.item.displayName}"
      >
        ${this.item.imageUrl
          ? html`
              <div class="item-image">
                <img
                  src="${this.item.imageUrl}"
                  alt="${this.item.displayName}"
                  title="${this.item.displayName}"
                />
              </div>
            `
          : ""}
        ${this.item.canUse
          ? html`<div class="item-key">
              ${this.item.slot === 6
                ? 4
                : this.item.slot < 3
                ? this.item.slot + 1
                : this.item.slot + 2}
            </div>`
          : ""}
        <div class="item-name">${this.item.displayName}</div>
        ${this.item.totalCost > 0
          ? html`<div class="item-cost">
              ${this.item.totalCost.toLocaleString()}g
            </div>`
          : this.item.price > 0
          ? html`<div class="item-cost">
              ${this.item.price.toLocaleString()}g
            </div>`
          : ""}
        ${this.item.count > 1
          ? html`<div class="item-count">x${this.item.count}</div>`
          : ""}
      </div>
    `;
  }

  static get styles() {
    return css`
      .item-slot {
        aspect-ratio: 1;
        border-radius: 4px;
        border: 2px solid var(--divider-color);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3px;
        text-align: center;
        position: relative;
        background-color: var(--primary-background-color);
        transition: all 0.2s ease;
      }
      .item-slot.trinket {
        border-color: #9c27b0;
        background-color: rgba(156, 39, 176, 0.05);
      }
      .item-slot.trinket.empty {
        border-color: rgba(156, 39, 176, 0.3);
        background-color: rgba(156, 39, 176, 0.1);
      }
      .item-slot:hover {
        border-color: var(--primary-color);
        transform: translateY(-1px);
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
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
      .item-slot.trinket.empty:hover {
        border-color: rgba(156, 39, 176, 0.3);
      }
      .item-image {
        margin-bottom: 2px;
      }
      .item-image img {
        width: 36px;
        height: 36px;
        border-radius: 3px;
        object-fit: cover;
        border: 1px solid var(--divider-color);
      }
      .item-name {
        font-size: 0.6em;
        font-weight: 500;
        color: var(--primary-text-color);
        line-height: 1.1;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .item-key {
        position: absolute;
        top: 2px;
        left: 2px;
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        font-size: 0.6em;
        font-weight: bold;
        padding: 1px 3px;
        border-radius: 2px;
        min-width: 8px;
        text-align: center;
        line-height: 1;
      }
      .item-count {
        position: absolute;
        bottom: 1px;
        right: 1px;
        background-color: var(--primary-color);
        color: white;
        font-size: 0.55em;
        font-weight: bold;
        padding: 1px 3px;
        border-radius: 2px;
        min-width: 10px;
        text-align: center;
      }
      .item-cost {
        position: absolute;
        bottom: 1px;
        left: 1px;
        background-color: rgba(255, 193, 7, 0.9);
        color: #000;
        font-size: 0.5em;
        font-weight: bold;
        padding: 1px 3px;
        border-radius: 2px;
        min-width: 15px;
        text-align: center;
        line-height: 1;
      }
    `;
  }
}

// Player Item Component
class PlayerItem extends LitElement {
  static get properties() {
    return {
      player: { type: Object },
    };
  }

  render() {
    if (!this.player) {
      return html``;
    }

    return html`
      <div class="player-item">
        ${this.player.championImageUrl
          ? html`
              <div class="player-champion-image">
                <img
                  src="${this.player.championImageUrl}"
                  alt="${this.player.championName}"
                  title="${this.player.championName}"
                />
              </div>
            `
          : ""}
        <div class="player-info">
          <div class="player-champion">${this.player.championName}</div>
          <div class="player-name">
            ${this.player.riotIdGameName ||
            this.player.summonerName ||
            "Unknown"}
          </div>
        </div>
        <div class="player-stats">
          <div class="player-level">Lv ${this.player.level || "?"}</div>
          <div class="player-score">
            ${this.player.scores.kills}/${this.player.scores.deaths}/${this
              .player.scores.assists}
          </div>
          <div class="player-cs">${this.player.scores.creepScore} CS</div>
        </div>
        ${this.player.isDead
          ? html`
              <div class="player-status dead">
                💀 ${Math.floor(this.player.respawnTimer)}s
              </div>
            `
          : ""}
      </div>
    `;
  }

  static get styles() {
    return css`
      .player-item {
        display: flex;
        align-items: center;
        padding: 4px 6px;
        background-color: var(--card-background-color);
        border-radius: 4px;
        border: 1px solid var(--divider-color);
        gap: 8px;
      }
      .player-champion-image {
        flex-shrink: 0;
      }
      .player-champion-image img {
        width: 32px;
        height: 32px;
        border-radius: 4px;
        object-fit: cover;
        border: 1px solid var(--primary-color);
      }
      .player-info {
        flex: 1;
        min-width: 0;
      }
      .player-champion {
        font-size: 0.7em;
        font-weight: 600;
        color: var(--primary-text-color);
        line-height: 1.1;
      }
      .player-name {
        font-size: 0.65em;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        line-height: 1.1;
      }
      .player-stats {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        flex-shrink: 0;
      }
      .player-level {
        font-size: 0.6em;
        color: var(--primary-color);
        font-weight: 600;
        text-align: right;
      }
      .player-score {
        font-size: 0.65em;
        font-weight: 500;
        color: var(--primary-text-color);
        text-align: right;
      }
      .player-cs {
        font-size: 0.6em;
        color: var(--secondary-text-color);
        text-align: right;
      }
      .player-status.dead {
        font-size: 0.6em;
        color: #ff5722;
        font-weight: 500;
        text-align: center;
        flex-shrink: 0;
      }
    `;
  }
}

// Team Section Component
class TeamSection extends LitElement {
  static get properties() {
    return {
      players: { type: Array },
      teamType: { type: String }, // 'teammates' or 'enemies'
      title: { type: String },
    };
  }

  render() {
    if (!this.players || this.players.length === 0) {
      return html``;
    }

    return html`
      <div class="team-section ${this.teamType}">
        <div class="team-header">${this.title}</div>
        <div class="players-grid">
          ${this.players.map(
            (player) =>
              html`<lol-player-item .player=${player}></lol-player-item>`
          )}
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      .team-section {
        margin-bottom: 8px;
        padding: 8px;
        border-radius: 6px;
        border: 1px solid var(--divider-color);
      }
      .team-section.teammates {
        background-color: rgba(76, 175, 80, 0.1);
        border-color: rgba(76, 175, 80, 0.3);
      }
      .team-section.enemies {
        background-color: rgba(244, 67, 54, 0.1);
        border-color: rgba(244, 67, 54, 0.3);
      }
      .team-header {
        font-size: 0.8em;
        font-weight: 600;
        text-transform: uppercase;
        text-align: center;
        margin-bottom: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--divider-color);
        color: var(--primary-text-color);
      }
      .players-grid {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
    `;
  }
}

// Ability Item Component
class AbilityItem extends LitElement {
  static get properties() {
    return {
      ability: { type: Object },
      keyName: { type: String },
      isEmpty: { type: Boolean },
    };
  }

  render() {
    if (this.isEmpty || !this.ability) {
      return html`<div class="ability-item empty"></div>`;
    }

    const isPassive = this.keyName === "P";
    const isUltimate = this.keyName === "R";
    const keyClass = isPassive ? "passive" : isUltimate ? "ultimate" : "";

    return html`
      <div class="ability-item">
        <div class="ability-key ${keyClass}">${this.keyName}</div>
        <div class="ability-info">
          <div class="ability-name">${this.ability.displayName}</div>
          ${this.ability.abilityLevel !== undefined
            ? html`
                <div class="ability-level">Lv ${this.ability.abilityLevel}</div>
              `
            : ""}
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      .ability-item {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        padding: 6px 3px;
        background-color: rgba(33, 150, 243, 0.1);
        border-radius: 4px;
        border: 1px solid rgba(33, 150, 243, 0.3);
        min-height: 50px;
      }
      .ability-item.empty {
        background-color: var(--disabled-color);
        opacity: 0.3;
        border-color: var(--divider-color);
      }
      .ability-key {
        background-color: #2196f3;
        color: white;
        font-weight: bold;
        font-size: 0.8em;
        padding: 4px 6px;
        border-radius: 3px;
        min-width: 20px;
        text-align: center;
      }
      .ability-key.passive {
        background-color: #9c27b0;
      }
      .ability-key.ultimate {
        background-color: #ff9800;
      }
      .ability-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
        text-align: center;
      }
      .ability-name {
        font-size: 0.6em;
        font-weight: 500;
        color: var(--primary-text-color);
        line-height: 1.1;
        text-align: center;
      }
      .ability-level {
        font-size: 0.55em;
        color: var(--secondary-text-color);
        font-weight: 500;
      }
    `;
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

customElements.define("lol-item-slot", ItemSlot);
customElements.define("lol-player-item", PlayerItem);
customElements.define("lol-team-section", TeamSection);
customElements.define("lol-ability-item", AbilityItem);
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
