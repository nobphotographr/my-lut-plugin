// 完全UXP版 main.js — LUTテンプレート＆写真適用フロー

const uxp       = require("uxp");
const fs        = uxp.storage.localFileSystem;
const { app, core, action, constants } = require("photoshop");

document.addEventListener("DOMContentLoaded", () => {
  const createTemplateBtn = document.getElementById("createTemplateBtn");
  const applyToPhotoBtn   = document.getElementById("applyToPhotoBtn");
  const applyFilmBtn      = document.getElementById("applyFilmBtn");
  const statusDiv         = document.getElementById("status");

  createTemplateBtn.addEventListener("click", createLutTemplate);
  applyToPhotoBtn  .addEventListener("click", applyToPhoto);
  applyFilmBtn     .addEventListener("click", applyAdvancedFilmEffects);

  function updateStatus(msg) {
    statusDiv.textContent = msg;
  }

  // ── フォルダ選択ユーティリティ ──
  async function pickFolder() {
    try {
      return await fs.getFolder();
    } catch (e) {
      console.error("pickFolder error:", e);
      return null;
    }
  }

  // ── ファイル選択ユーティリティ（.psdフィルタ付き） ──
  async function pickFile() {
    try {
      const result = await fs.getFileForOpening({
        types:         ["psd"],
        allowMultiple: false
      });
      // 配列の場合は最初の要素を、それ以外はそのまま
      const file = Array.isArray(result) ? result[0] : result;
      console.log("🔹 pickFile result is array?", Array.isArray(result), "=> file:", file?.name);
      return file;
    } catch (e) {
      console.error("pickFile cancelled or error:", e);
      return null;
    }
  }

  // ── 新規ドキュメント作成 ──
  async function createDocument(name, width = 1000, height = 1000) {
    try {
      await core.executeAsModal(() => {
        action.batchPlay([{
          _obj:   "make",
          _target:[{ _ref: "document" }],
          using:  {
            _obj:       "document",
            name,
            width:      { _unit: "pixelsUnit", _value: width },
            height:     { _unit: "pixelsUnit", _value: height },
            resolution: { _unit: "densityUnit", _value: 72 },
            mode:       { _enum: "documentMode",   _value: "RGBColorMode" },
            fill:       { _enum: "fillContents",   _value: "white" }
          }
        }], { synchronousExecution: true });
      }, { commandName: "Create Document" });
      return true;
    } catch (e) {
      console.error("createDocument error:", e);
      return false;
    }
  }

  // ── カラールックアップ調整レイヤー作成 ──
  async function createColorLookupLayer(layerName) {
    try {
      await core.executeAsModal(() => {
        action.batchPlay([{
          _obj:   "make",
          _target:[{ _ref: "adjustmentLayer" }],
          using:  {
            _obj:   "adjustmentLayer",
            name:   layerName,
            type:   { _class: "colorLookup" }
          }
        }], { synchronousExecution: true });
      }, { commandName: `Create Color Lookup Layer: ${layerName}` });
    } catch (e) {
      console.error("createColorLookupLayer error:", e);
    }
  }

  // ── 新規LUTテンプレート作成 ──
  async function createLutTemplate() {
    if (!confirm("新規LUTテンプレートを作成しますか？")) return;

    const folder = await pickFolder();
    if (!folder) {
      alert("フォルダが選択されませんでした");
      return;
    }

    const entries = await folder.getEntries();
    const cubeFiles = entries.filter(e =>
      e.isFile && e.name.toLowerCase().endsWith(".cube")
    );
    if (!cubeFiles.length) {
      alert("LUTファイルが見つかりません");
      return;
    }

    const docName = `LUT_Template_${Date.now()}`;
    if (!await createDocument(docName, 800, 800)) {
      alert("ドキュメント作成に失敗しました");
      return;
    }

    for (const file of cubeFiles) {
      const base = file.name.replace(/\.[^.]+$/, "");
      await createColorLookupLayer(base);
    }

    updateStatus("テンプレート作成完了");
    alert("カラールックアップ調整レイヤーを作成しました。");
  }

  // ── 写真にLUT適用 ──
  async function applyToPhoto() {
    console.log("▶ applyToPhoto start");
    if (!app.activeDocument) {
      alert("最初に写真を開いてください。");
      return;
    }
    const photoDoc = app.activeDocument;

    const templateFile = await pickFile();
    if (!templateFile) {
      alert("テンプレートPSDが選択されませんでした");
      return;
    }
    console.log("📁 templateFile:", templateFile.name);

    let templateDoc;
    let adjustmentLayers = [];

    // ── ここでまとめてモーダル化 ──
    await core.executeAsModal(async () => {
      // 1) テンプレートを開く
      templateDoc = await app.open(templateFile);
      console.log("📂 templateDoc:", templateDoc.title);

      // 2) 調整レイヤーを収集
      (function collect(layers) {
        for (const layer of layers) {
          console.log("　– layer:", layer.name, "kind=", layer.kind);
          if (layer.kind === constants.LayerKind.COLORLOOKUP) {
            adjustmentLayers.push(layer);
          }
          if (layer.layers?.length) collect(layer.layers);
        }
      })(templateDoc.layers);
      console.log(`🔍 調整レイヤー数: ${adjustmentLayers.length}`);

      // 3) 写真へ一括複製
      if (adjustmentLayers.length) {
        console.log("↪ duplicateLayers call");
        await templateDoc.duplicateLayers(adjustmentLayers, photoDoc);
      }

      // 4) テンプレートを閉じて、写真をアクティベート
      await templateDoc.close(constants.SaveOptions.DONOTSAVECHANGES);
      await photoDoc.activate();
    }, { commandName: "Apply LUT Layers" });

    console.log("✅ applyToPhoto done");
    updateStatus("写真へのLUT適用完了");
    alert("テンプレートから調整レイヤーを適用しました。");
  }

  // ── フィルムエフェクト設定定数 ──
  const FILM_EFFECTS_CONFIG = {
    halation: {
      enabled: true,
      name: "Halation",
      blurRadius: 25,
      opacity: 15,
      blendMode: "screen"
    },
    dreamyHaze: {
      enabled: true,
      name: "Dreamy Haze",
      blurRadius: 8,
      opacity: 20,
      blendMode: "softLight"
    },
    darkGrain: {
      enabled: true,
      name: "Dark Grain",
      grainAmount: 25,
      opacity: 40,
      blendMode: "multiply"
    }
  };

  // ── Filmレイヤー適用（新機能） ──
  async function applyFilmLayer() {
    console.log("▶ applyFilmLayer start");
    if (!app.activeDocument) {
      alert("最初に写真を開いてください。");
      return;
    }

    try {
      await core.executeAsModal(() => {
        // フィルムエミュレーション効果を作成
        // 例：セピア調の効果を追加
        action.batchPlay([{
          _obj: "make",
          _target: [{ _ref: "adjustmentLayer" }],
          using: {
            _obj: "adjustmentLayer",
            name: "Film Emulation",
            type: { _class: "colorBalance" }
          }
        }], { synchronousExecution: true });
      }, { commandName: "Apply Film Layer" });

      updateStatus("Filmレイヤー適用完了");
      alert("フィルムエミュレーションレイヤーを追加しました。");
    } catch (e) {
      console.error("applyFilmLayer error:", e);
      alert("Filmレイヤーの適用に失敗しました。");
    }
  }

  // ── 高度なFilmエフェクト適用 ──
  async function applyAdvancedFilmEffects() {
    console.log("▶ applyAdvancedFilmEffects start");
    
    if (!app.activeDocument) {
      alert("最初に写真を開いてください。");
      return;
    }

    if (!confirm("高度なフィルムエフェクト（ハレーション、Dreamy Haze、暗部グレイン）を適用しますか？\n処理に時間がかかる場合があります。")) {
      return;
    }

    try {
      updateStatus("フィルムエフェクト処理中...");
      
      await core.executeAsModal(async () => {
        // 各エフェクトを段階的に適用
        console.log("🎬 Starting film effects application...");
        
        // ハレーション効果
        if (FILM_EFFECTS_CONFIG.halation.enabled) {
          console.log("✨ Applying halation effect...");
          await applyHalationEffect();
        }
        
        // Dreamy Haze効果
        if (FILM_EFFECTS_CONFIG.dreamyHaze.enabled) {
          console.log("🌙 Applying dreamy haze effect...");
          await applyDreamyHazeEffect();
        }
        
        // 暗部グレイン効果
        if (FILM_EFFECTS_CONFIG.darkGrain.enabled) {
          console.log("📽️ Applying dark grain effect...");
          await applyDarkGrainEffect();
        }
        
        console.log("🎉 All film effects applied successfully!");
      }, { commandName: "Apply Advanced Film Effects" });

      updateStatus("高度なフィルムエフェクト適用完了");
      alert("すべてのフィルムエフェクトが適用されました！\nレイヤーパネルで各エフェクトレイヤーを確認してください。");
      
    } catch (e) {
      console.error("applyAdvancedFilmEffects error:", e);
      updateStatus("エラーが発生しました");
      alert("フィルムエフェクトの適用中にエラーが発生しました: " + e.message);
    }
  }

  // ── ハレーション効果の適用 ──
  async function applyHalationEffect() {
    try {
      console.log("🌟 Creating halation effect...");
      
      const config = FILM_EFFECTS_CONFIG.halation;
      
      // 1) 現在のレイヤーを複製
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        name: config.name
      }], { synchronousExecution: true });
      
      // 2) ガウシアンブラーを適用
      await action.batchPlay([{
        _obj: "gaussianBlur",
        radius: { _unit: "pixelsUnit", _value: config.blurRadius },
        integerMath: false,
        _options: { dialogOptions: "dontDisplay" }
      }], { synchronousExecution: true });
      
      // 3) ブレンドモードをスクリーンに変更
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: config.blendMode }
        }
      }], { synchronousExecution: true });
      
      // 4) 不透明度を調整
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          opacity: { _unit: "percentUnit", _value: config.opacity }
        }
      }], { synchronousExecution: true });
      
      console.log(`✨ Halation effect applied successfully (opacity: ${config.opacity}%, blur: ${config.blurRadius}px)`);
      
    } catch (e) {
      console.error("applyHalationEffect error:", e);
      throw new Error(`ハレーション効果の適用に失敗: ${e.message}`);
    }
  }

  // ── Dreamy Haze効果の適用 ──
  async function applyDreamyHazeEffect() {
    try {
      console.log("🌙 Creating dreamy haze effect...");
      
      const config = FILM_EFFECTS_CONFIG.dreamyHaze;
      
      // 1) 現在のレイヤーを複製
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        name: config.name
      }], { synchronousExecution: true });
      
      // 2) より小さなガウシアンブラーを適用（dreamy効果）
      await action.batchPlay([{
        _obj: "gaussianBlur",
        radius: { _unit: "pixelsUnit", _value: config.blurRadius },
        integerMath: false,
        _options: { dialogOptions: "dontDisplay" }
      }], { synchronousExecution: true });
      
      // 3) ブレンドモードをソフトライトに変更
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: config.blendMode }
        }
      }], { synchronousExecution: true });
      
      // 4) 不透明度を調整
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          opacity: { _unit: "percentUnit", _value: config.opacity }
        }
      }], { synchronousExecution: true });
      
      // 5) 軽いカラーバランス調整（より暖かく）
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: "Dreamy Warmth",
          type: {
            _obj: "colorBalance",
            shadowLevels: [-5, 0, 15],
            midtoneLevels: [-10, 0, 10],
            highlightLevels: [-8, 0, 5],
            preserveLuminosity: true
          }
        }
      }], { synchronousExecution: true });
      
      // 6) 調整レイヤーをDreamy Hazeレイヤーにクリップ
      await action.batchPlay([{
        _obj: "groupLayersEvent",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
      }], { synchronousExecution: true });
      
      console.log(`🌙 Dreamy haze effect applied successfully (opacity: ${config.opacity}%, blur: ${config.blurRadius}px)`);
      
    } catch (e) {
      console.error("applyDreamyHazeEffect error:", e);
      throw new Error(`Dreamy Haze効果の適用に失敗: ${e.message}`);
    }
  }

  // ── 暗部グレイン効果の適用 ──
  async function applyDarkGrainEffect() {
    try {
      console.log("📽️ Creating dark grain effect...");
      
      const config = FILM_EFFECTS_CONFIG.darkGrain;
      
      // 1) 新しいレイヤーを作成
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "layer" }],
        using: {
          _obj: "layer",
          name: config.name
        }
      }], { synchronousExecution: true });
      
      // 2) 50%グレーで塗りつぶし
      await action.batchPlay([{
        _obj: "fill",
        using: {
          _enum: "fillContents",
          _value: "gray"
        },
        mode: {
          _enum: "blendMode",
          _value: "normal"
        },
        opacity: {
          _unit: "percentUnit",
          _value: 100
        }
      }], { synchronousExecution: true });
      
      // 3) ノイズフィルターを適用
      await action.batchPlay([{
        _obj: "addNoise",
        amount: { _unit: "percentUnit", _value: config.grainAmount },
        distribution: { _enum: "distribution", _value: "gaussian" },
        monochromatic: true
      }], { synchronousExecution: true });
      
      // 4) ブレンドモードをオーバーレイに変更（より自然な効果）
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: "overlay" }
        }
      }], { synchronousExecution: true });
      
      // 5) 不透明度を調整
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          opacity: { _unit: "percentUnit", _value: config.opacity }
        }
      }], { synchronousExecution: true });
      
      console.log(`📽️ Dark grain effect applied successfully (opacity: ${config.opacity}%, grain: ${config.grainAmount}%)`);
      
    } catch (e) {
      console.error("applyDarkGrainEffect error:", e);
      throw new Error(`暗部グレイン効果の適用に失敗: ${e.message}`);
    }
  }
});