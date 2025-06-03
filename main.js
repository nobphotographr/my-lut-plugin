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

  // カスタムアラートダイアログ関数
  function showAlert(message) {
    const dialog = document.createElement('dialog');
    dialog.className = 'alert-dialog';  // クラス追加
    
    dialog.innerHTML = `
      <form method="dialog">
        <h2>LUT Launcher</h2>
        <div class="dialog-content">
          <p>${message}</p>
        </div>
        <div class="dialog-buttons">
          <button type="submit" class="primary">OK</button>
        </div>
      </form>
    `;
    
    document.body.appendChild(dialog);
    dialog.showModal();
    
    dialog.addEventListener('close', () => {
      dialog.remove();
    });
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
      showAlert("フォルダが選択されませんでした");
      return;
    }

    const entries = await folder.getEntries();
    const cubeFiles = entries.filter(e =>
      e.isFile && e.name.toLowerCase().endsWith(".cube")
    );
    if (!cubeFiles.length) {
      showAlert("LUTファイルが見つかりません");
      return;
    }

    const docName = `LUT_Template_${Date.now()}`;
    if (!await createDocument(docName, 800, 800)) {
      showAlert("ドキュメント作成に失敗しました");
      return;
    }

    for (const file of cubeFiles) {
      const base = file.name.replace(/\.[^.]+$/, "");
      await createColorLookupLayer(base);
    }

    updateStatus("テンプレート作成完了");
    showAlert("カラールックアップ調整レイヤーを作成しました。");
  }

  // ── 写真にLUT適用 ──
  async function applyToPhoto() {
    console.log("▶ applyToPhoto start");
    if (!app.activeDocument) {
      showAlert("最初に写真を開いてください。");
      return;
    }
    const photoDoc = app.activeDocument;

    const templateFile = await pickFile();
    if (!templateFile) {
      showAlert("テンプレートPSDが選択されませんでした");
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
    showAlert("テンプレートから調整レイヤーを適用しました。");
  }

  // ── フィルムエフェクト設定定数 ──
  const FILM_EFFECTS_CONFIG = {
    halation: {
      enabled: true,
      name: "Halation",
      threshold: 200,        // 2階調化しきい値（より明るい部分のみ）
      blurRadius: 30,        // ガウスぼかし半径
      opacity: 60,           // スクリーンレイヤーの不透明度（控えめに）
      color: { r: 255, g: 200, b: 150 }, // より淡いオレンジ色
      overlayOpacity: 15     // オーバーレイレイヤーの不透明度（かなり控えめに）
    },
    dreamyHaze: {
      enabled: true,
      name: "Dreamy Haze",
      // メインのぼかし効果
      blur: {
        radius: 50,
        blendMode: "screen",
        opacity: 90
      },
      // トーンカーブ（フェード効果）
      toneCurve: {
        enabled: true,
        points: [
          { x: 0, y: 8 },      // 暗部を持ち上げる
          { x: 255, y: 250 }   // ハイライトを抑える
        ]
      },
      // グラデーションマップ
      gradientMap: {
        enabled: true,
        colors: [
          { hex: "000000", location: 0 },    // 黒
          { hex: "FFFF00", location: 100 }   // 黄色
        ],
        blendMode: "screen",
        opacity: 15
      }
    },
    darkGrain: {
      enabled: true,
      name: "Dark Grain",
      grainAmount: 25,
      opacity: 40,
      blendMode: "overlay",
      shadowThreshold: 80,
      featherRadius: 20
    },
    organization: {
      useGroups: true,
      mainGroupName: "Film Effects"
    }
  };

  // ── Filmレイヤー適用（新機能） ──
  async function applyFilmLayer() {
    console.log("▶ applyFilmLayer start");
    if (!app.activeDocument) {
      showAlert("最初に写真を開いてください。");
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
      showAlert("フィルムエミュレーションレイヤーを追加しました。");
    } catch (e) {
      console.error("applyFilmLayer error:", e);
      showAlert("Filmレイヤーの適用に失敗しました。");
    }
  }

  // ── 高度なFilmエフェクト適用 ──
  async function applyAdvancedFilmEffects() {
    console.log("▶ applyAdvancedFilmEffects start");
    
    if (!app.activeDocument) {
      showAlert("最初に写真を開いてください。");
      return;
    }

    // 閾値設定ダイアログを表示
    let thresholdSettings;
    try {
      thresholdSettings = await showThresholdDialog();
      console.log("閾値設定:", thresholdSettings);
      
      // 設定を更新
      FILM_EFFECTS_CONFIG.halation.enabled = thresholdSettings.halationEnabled;
      FILM_EFFECTS_CONFIG.halation.threshold = thresholdSettings.threshold;
      FILM_EFFECTS_CONFIG.halation.blurRadius = thresholdSettings.blurRadius;
      FILM_EFFECTS_CONFIG.dreamyHaze.enabled = thresholdSettings.dreamyHaze.enabled;
      FILM_EFFECTS_CONFIG.dreamyHaze.blur.radius = thresholdSettings.dreamyHaze.blurRadius;
      FILM_EFFECTS_CONFIG.dreamyHaze.blur.opacity = thresholdSettings.dreamyHaze.blurOpacity;
      FILM_EFFECTS_CONFIG.dreamyHaze.toneCurve.enabled = thresholdSettings.dreamyHaze.enableToneCurve;
      FILM_EFFECTS_CONFIG.dreamyHaze.gradientMap.enabled = thresholdSettings.dreamyHaze.enableGradientMap;
      FILM_EFFECTS_CONFIG.dreamyHaze.gradientMap.opacity = thresholdSettings.dreamyHaze.gradientMapOpacity;
      FILM_EFFECTS_CONFIG.darkGrain.enabled = thresholdSettings.darkGrainEnabled;
      FILM_EFFECTS_CONFIG.darkGrain.shadowThreshold = thresholdSettings.shadowThreshold;
      FILM_EFFECTS_CONFIG.darkGrain.grainAmount = thresholdSettings.grainAmount;
      FILM_EFFECTS_CONFIG.darkGrain.featherRadius = thresholdSettings.featherRadius;
    } catch (e) {
      console.log("ダイアログがキャンセルされました");
      updateStatus("処理がキャンセルされました");
      return;
    }

    try {
      updateStatus("フィルムエフェクト処理中...");
      
      await core.executeAsModal(async () => {
        console.log("🎬 Starting film effects application...");
        
        // Film Effectsグループを取得または作成（１回だけ）
        let filmEffectsGroup = null;
        if (FILM_EFFECTS_CONFIG.organization.useGroups) {
          filmEffectsGroup = await getOrCreateFilmEffectsGroup();
        }
        
        // ベースレイヤーを記録（各エフェクトはこのレイヤーを基準に適用）
        const doc = app.activeDocument;
        let baseLayerName = "Background"; // デフォルト値
        
        try {
          if (doc.layers && doc.layers.length > 0) {
            // アクティブレイヤーがない場合は最初のレイヤーを使用
            baseLayerName = doc.activeLayer ? doc.activeLayer.name : doc.layers[0].name;
          }
        } catch (e) {
          console.log("レイヤー名取得エラー、デフォルト値使用:", e.message);
        }
        
        console.log("📐 Base layer:", baseLayerName);
        
        // ハレーション効果
        if (FILM_EFFECTS_CONFIG.halation.enabled) {
          console.log("✨ Applying halation effect...");
          await selectBottomLayer();
          await applyHalationEffect();
          
          // レイヤーを同じグループに移動
          if (filmEffectsGroup) {
            try {
              await moveLayerToGroup("Halation Color", filmEffectsGroup);
              await moveLayerToGroup("Halation Base", filmEffectsGroup);
            } catch (e) {
              console.log("Halationレイヤーの移動エラー（無視）:", e.message);
            }
          }
        }
        
        // Dreamy Haze効果
        if (FILM_EFFECTS_CONFIG.dreamyHaze.enabled) {
          console.log("🌙 Applying dreamy haze effect...");
          await selectBottomLayer();
          await applyDreamyHazeEffect();
          
          // レイヤーを同じグループに移動
          if (filmEffectsGroup) {
            try {
              await moveLayerToGroup("Gradient Map Adjust", filmEffectsGroup);
              await moveLayerToGroup("Tone Curve Adjust", filmEffectsGroup);
              await moveLayerToGroup("Blur Screen", filmEffectsGroup);
            } catch (e) {
              console.log("Dreamyレイヤーの移動エラー（無視）:", e.message);
            }
          }
        }
        
        // 暗部グレイン効果
        if (FILM_EFFECTS_CONFIG.darkGrain.enabled) {
          console.log("📽️ Applying dark grain effect...");
          await selectBottomLayer();
          await applyDarkGrainEffect();
          
          // レイヤーを同じグループに移動
          if (filmEffectsGroup) {
            try {
              await moveLayerToGroup("Dark Grain", filmEffectsGroup);
            } catch (e) {
              console.log("Dark Grainレイヤーの移動エラー（無視）:", e.message);
            }
          }
        }
        
        console.log("🎉 All film effects applied successfully!");
      }, { commandName: "Apply Advanced Film Effects" });

      updateStatus("高度なフィルムエフェクト適用完了");
      showAlert("すべてのフィルムエフェクトが適用されました！<br>レイヤーパネルで各エフェクトレイヤーを<br>確認してください。");
      
    } catch (e) {
      console.error("applyAdvancedFilmEffects error:", e);
      updateStatus("エラーが発生しました");
      showAlert("フィルムエフェクトの適用中にエラーが発生しました:<br>" + e.message);
    }
  }

  // ── レイヤー選択ユーティリティ ──
  async function selectBottomLayer() {
    try {
      // 最下位レイヤー（通常は元の写真）を選択
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "back" }]
      }], { synchronousExecution: true });
    } catch (e) {
      console.log("レイヤー選択エラー (無視):", e.message);
    }
  }

  // ── Film Effectsグループを取得または作成する関数 ──
  async function getOrCreateFilmEffectsGroup() {
    try {
      // 1) 既存のFilm Effectsグループを検索
      const doc = app.activeDocument;
      for (const layer of doc.layers) {
        if (layer.kind === constants.LayerKind.GROUP && layer.name === "Film Effects") {
          console.log("🔍 Found existing Film Effects group, reusing it");
          return layer; // 既存グループを返す
        }
      }
      
      // 2) 見つからない場合は新規作成
      console.log("📁 Creating new Film Effects group");
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "layerSection" }],
        using: {
          _obj: "layerSection",
          name: "Film Effects"
        }
      }], { synchronousExecution: true });
      
      // 作成したグループを返す（最上位レイヤーが新しく作成されたグループ）
      return doc.layers[0];
      
    } catch (e) {
      console.error("getOrCreateFilmEffectsGroup error:", e);
      return null;
    }
  }

  // ── レイヤーをグループに移動する関数（グループレイヤーオブジェクト版） ──
  async function moveLayerToGroup(layerName, groupLayer) {
    try {
      if (!groupLayer) {
        console.error("moveLayerToGroup: groupLayer is null");
        return;
      }
      
      // レイヤーを選択
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _name: layerName }]
      }], { synchronousExecution: true });
      
      // グループレイヤーのIDを使用して移動
      await action.batchPlay([{
        _obj: "move",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _ref: "layer", _id: groupLayer.id },
        adjustment: false,
        version: 5
      }], { synchronousExecution: true });
      
      console.log(`📁 Moved layer "${layerName}" to group "${groupLayer.name}"`);
    } catch (e) {
      console.error("moveLayerToGroup error:", e);
    }
  }

  // ── フィルムエフェクト設定ダイアログ関数 ──
  async function showThresholdDialog() {
    return new Promise((resolve, reject) => {
      const dialog = document.getElementById('thresholdDialog');
      
      // ハレーション設定の要素
      const enableHalation = document.getElementById('enableHalation');
      const thresholdInput = document.getElementById('thresholdInput');
      const blurRadiusInput = document.getElementById('blurRadiusInput');
      
      // Dreamy Haze設定の要素
      const enableDreamyHaze = document.getElementById('enableDreamyHaze');
      const dreamyBlurRadiusInput = document.getElementById('dreamyBlurRadiusInput');
      const dreamyBlurOpacityInput = document.getElementById('dreamyBlurOpacityInput');
      const dreamyToneCurve = document.getElementById('dreamyToneCurve');
      const dreamyGradientMap = document.getElementById('dreamyGradientMap');
      const dreamyGradientOpacityInput = document.getElementById('dreamyGradientOpacityInput');
      
      // グレイン設定の要素
      const enableDarkGrain = document.getElementById('enableDarkGrain');
      const shadowThresholdInput = document.getElementById('shadowThresholdInput');
      const grainAmountInput = document.getElementById('grainAmountInput');
      const featherRadiusInput = document.getElementById('featherRadiusInput');
      
      const cancelBtn = document.getElementById('cancelBtn');
      const applyBtn = document.getElementById('applyBtn');
      
      // 現在の値を設定
      enableHalation.checked = FILM_EFFECTS_CONFIG.halation.enabled;
      thresholdInput.value = FILM_EFFECTS_CONFIG.halation.threshold;
      blurRadiusInput.value = FILM_EFFECTS_CONFIG.halation.blurRadius;
      
      enableDreamyHaze.checked = FILM_EFFECTS_CONFIG.dreamyHaze.enabled;
      dreamyBlurRadiusInput.value = FILM_EFFECTS_CONFIG.dreamyHaze.blur.radius;
      dreamyBlurOpacityInput.value = FILM_EFFECTS_CONFIG.dreamyHaze.blur.opacity;
      dreamyToneCurve.checked = FILM_EFFECTS_CONFIG.dreamyHaze.toneCurve.enabled;
      dreamyGradientMap.checked = FILM_EFFECTS_CONFIG.dreamyHaze.gradientMap.enabled;
      dreamyGradientOpacityInput.value = FILM_EFFECTS_CONFIG.dreamyHaze.gradientMap.opacity;
      
      enableDarkGrain.checked = FILM_EFFECTS_CONFIG.darkGrain.enabled;
      shadowThresholdInput.value = FILM_EFFECTS_CONFIG.darkGrain.shadowThreshold;
      grainAmountInput.value = FILM_EFFECTS_CONFIG.darkGrain.grainAmount;
      featherRadiusInput.value = FILM_EFFECTS_CONFIG.darkGrain.featherRadius;
      
      // スライダー関連処理を削除（数値入力フィールドに変更のため）
      
      // キャンセルボタン
      const handleCancel = () => {
        dialog.close();
        cleanup();
        reject(new Error('ユーザーがキャンセルしました'));
      };
      
      // 適用ボタン
      const handleApply = (e) => {
        e.preventDefault();
        
        const settings = {
          // ハレーション設定
          halationEnabled: enableHalation.checked,
          threshold: parseInt(thresholdInput.value),
          blurRadius: parseInt(blurRadiusInput.value),
          // Dreamy Haze設定
          dreamyHaze: {
            enabled: enableDreamyHaze.checked,
            blurRadius: parseInt(dreamyBlurRadiusInput.value),
            blurOpacity: parseInt(dreamyBlurOpacityInput.value),
            enableToneCurve: dreamyToneCurve.checked,
            enableGradientMap: dreamyGradientMap.checked,
            gradientMapOpacity: parseInt(dreamyGradientOpacityInput.value)
          },
          // グレイン設定
          darkGrainEnabled: enableDarkGrain.checked,
          shadowThreshold: parseInt(shadowThresholdInput.value),
          grainAmount: parseInt(grainAmountInput.value),
          featherRadius: parseInt(featherRadiusInput.value)
        };
        
        console.log("適用ボタンがクリックされました:", settings);
        
        dialog.close();
        cleanup();
        resolve(settings);
      };
      
      // フォームのsubmitイベント
      const form = dialog.querySelector('form');
      const handleSubmit = (e) => {
        e.preventDefault();
        handleApply(e);
      };
      
      // イベントリスナーのクリーンアップ
      const cleanup = () => {
        cancelBtn.removeEventListener('click', handleCancel);
        applyBtn.removeEventListener('click', handleApply);
        form.removeEventListener('submit', handleSubmit);
      };
      
      // イベントリスナーを追加
      cancelBtn.addEventListener('click', handleCancel);
      applyBtn.addEventListener('click', handleApply);
      form.addEventListener('submit', handleSubmit);
      
      // ダイアログのcloseイベント（デバッグ用）
      const handleDialogClose = () => {
        console.log("ダイアログがクローズされました");
        dialog.removeEventListener('close', handleDialogClose);
      };
      
      dialog.addEventListener('close', handleDialogClose);
      
      // ダイアログを表示
      console.log("ダイアログを表示します");
      dialog.showModal();
    });
  }

  // ── ハレーション効果の適用（ExtendScript版互換） ──
  async function applyHalationEffect() {
    try {
      console.log("🌟 Creating precise halation effect (ExtendScript style)...");
      
      const config = FILM_EFFECTS_CONFIG.halation;
      
      // 1) レイヤーを複製
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        name: config.name + " Base",
        version: 5
      }], { synchronousExecution: true });
      
      // 2) 2階調化を適用
      await action.batchPlay([{
        _obj: "thresholdClassEvent",
        level: config.threshold
      }], { synchronousExecution: true });
      
      // 3) ガウスぼかしを適用
      await action.batchPlay([{
        _obj: "gaussianBlur",
        radius: { _unit: "pixelsUnit", _value: config.blurRadius }
      }], { synchronousExecution: true });
      
      // 4) ブレンドモードをスクリーンに設定
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: "screen" }
        }
      }], { synchronousExecution: true });
      
      // 5) 塗りつぶしレイヤーを作成（オレンジ色）
      await action.batchPlay([{
        _obj: "make",
        _target: [{ _ref: "contentLayer" }],
        using: {
          _obj: "contentLayer",
          name: config.name + " Color",
          type: {
            _obj: "solidColorLayer",
            color: {
              _obj: "RGBColor",
              red: config.color.r,
              grain: config.color.g,
              blue: config.color.b
            }
          }
        }
      }], { synchronousExecution: true });
      
      // 6) クリッピングマスクを作成（修正版）
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          group: true
        }
      }], { synchronousExecution: true });
      
      // 7) 塗りつぶしレイヤーの描画モードをオーバーレイに変更
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: "overlay" },
          opacity: { _unit: "percentUnit", _value: config.overlayOpacity }
        }
      }], { synchronousExecution: true });
      
      console.log(`✨ Halation effect applied successfully (ExtendScript style)`);
      
    } catch (e) {
      console.error("applyHalationEffect error:", e);
      throw new Error(`ハレーション効果の適用に失敗: ${e.message}`);
    }
  }

  // ── Dreamy Haze効果の適用（ExtendScript版互換） ──
  async function applyDreamyHazeEffect() {
    try {
      console.log("🌙 Creating dreamy haze effect (ExtendScript compatible)...");
      
      const config = FILM_EFFECTS_CONFIG.dreamyHaze;
      
      // 1) レイヤーを複製（Blur Screen）
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        name: "Blur Screen"
      }], { synchronousExecution: true });
      
      // 2) ガウシアンブラー適用（ExtendScript版: 50px）
      await action.batchPlay([{
        _obj: "gaussianBlur",
        radius: { _unit: "pixelsUnit", _value: config.blur.radius }
      }], { synchronousExecution: true });
      
      // 3) ブレンドモードとオパシティ設定（ExtendScript版: Screen, 90%）
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: config.blur.blendMode },
          opacity: { _unit: "percentUnit", _value: config.blur.opacity }
        }
      }], { synchronousExecution: true });
      
      // 4) トーンカーブ調整レイヤー（フェード効果）
      if (config.toneCurve.enabled) {
        await action.batchPlay([{
          _obj: "make",
          _target: [{ _ref: "adjustmentLayer" }],
          using: {
            _obj: "adjustmentLayer",
            name: "Tone Curve Adjust",
            type: {
              _obj: "curves",
              adjustment: [{
                _obj: "curvesAdjustment",
                channel: { _ref: "channel", _enum: "channel", _value: "composite" },
                curve: [
                  { _obj: "paintPoint", horizontal: config.toneCurve.points[0].x, vertical: config.toneCurve.points[0].y },
                  { _obj: "paintPoint", horizontal: config.toneCurve.points[1].x, vertical: config.toneCurve.points[1].y }
                ]
              }]
            }
          }
        }], { synchronousExecution: true });
      }
      
      // 5) グラデーションマップ調整レイヤー（黒→黄色）
      if (config.gradientMap.enabled) {
        await action.batchPlay([{
          _obj: "make",
          _target: [{ _ref: "adjustmentLayer" }],
          using: {
            _obj: "adjustmentLayer",
            name: "Gradient Map Adjust",
            type: {
              _obj: "gradientMapClass",
              gradient: {
                _obj: "gradientClassEvent",
                name: "Black to Yellow",
                gradientForm: { _enum: "gradientForm", _value: "customStops" },
                interfaceIconFrameDimmed: 4096,
                colors: [
                  {
                    _obj: "colorStop",
                    color: {
                      _obj: "RGBColor",
                      red: 0, 
                      green: 0, 
                      blue: 0
                    },
                    type: { _enum: "colorStopType", _value: "userStop" },
                    location: 0,
                    midpoint: 50
                  },
                  {
                    _obj: "colorStop",
                    color: {
                      _obj: "RGBColor",
                      red: 255, 
                      green: 255, 
                      blue: 0
                    },
                    type: { _enum: "colorStopType", _value: "userStop" },
                    location: 4096,
                    midpoint: 50
                  }
                ]
              }
            }
          }
        }], { synchronousExecution: true });
        
        // グラデーションマップのブレンドモードと不透明度を設定
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: {
            _obj: "layer",
            mode: { _enum: "blendMode", _value: config.gradientMap.blendMode },
            opacity: { _unit: "percentUnit", _value: config.gradientMap.opacity }
          }
        }], { synchronousExecution: true });
      }
      
      console.log(`🌙 Dreamy haze effect applied successfully (ExtendScript style)`);
      
    } catch (e) {
      console.error("applyDreamyHazeEffect error:", e);
      throw new Error(`Dreamy Haze効果の適用に失敗: ${e.message}`);
    }
  }

  // ── 暗部グレイン効果の適用（JSX完全互換・正確版） ──
  async function applyDarkGrainEffect() {
    try {
      console.log("📽️ Creating dark grain effect with shadow masking...");
      
      const config = FILM_EFFECTS_CONFIG.darkGrain;
      const doc = app.activeDocument;
      
      // 最下位レイヤー（元画像）を明示的に選択
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "back" }]
      }], { synchronousExecution: true });
      
      // UXPでは activeLayers[0] を使用
      const activeArr = doc.activeLayers;
      if (!activeArr || activeArr.length === 0) {
        throw new Error("ベースレイヤーが見つかりません");
      }
      let originalLayer = activeArr[0];
      
      console.log("Original layer:", originalLayer.name, "Kind:", originalLayer.kind);
      
      // グループレイヤーの場合はスキップ
      if (originalLayer.kind === constants.LayerKind.GROUP) {
        throw new Error("ベースレイヤーがグループです。通常のレイヤーを選択してください");
      }
      
      let originalLayerId = originalLayer.id; // UXPでは.idプロパティ
      console.log("Using layer ID:", originalLayerId);
      
      // 1) 元レイヤーを選択してColor Rangeで暗部を選択
      try {
        await action.batchPlay([{
          _obj: "select",
          _target: [{ _ref: "layer", _id: originalLayerId }]
        }], { synchronousExecution: true });
        
        await action.batchPlay([{
          _obj: "colorRange",
          colors: { _enum: "colors", _value: "shadows" },
          colorRange: config.shadowThreshold
        }], { synchronousExecution: true });
        console.log("✓ Shadow selection created from original layer");
      } catch (e) {
        console.error("Shadow selection failed:", e);
        throw new Error("暗部選択に失敗しました");
      }
      
      // 2) 選択範囲をフェザー（1回だけ）
      if (config.featherRadius > 0) {
        try {
          await action.batchPlay([{
            _obj: "feather",
            radius: { _unit: "pixelsUnit", _value: config.featherRadius }
          }], { synchronousExecution: true });
          console.log(`✓ Selection feathered: ${config.featherRadius}px`);
        } catch (e) {
          console.error("Feather failed:", e);
        }
      }
      
      // 3) 選択範囲をチャンネルに正確に保存（JSXと同じ方法）
      try {
        await action.batchPlay([{
          _obj: "duplicate",
          _target: [{ _ref: "channel", _property: "selection" }],
          name: "__shadowSelectionMask"
        }], { synchronousExecution: true });
        console.log("✓ Selection saved to channel");
      } catch (e) {
        console.error("Selection save failed:", e);
        throw new Error("選択範囲の保存に失敗しました");
      }
      
      // 4) 新しいレイヤーを作成
      try {
        await action.batchPlay([{
          _obj: "make",
          _target: [{ _ref: "layer" }],
          using: {
            _obj: "layer",
            name: config.name,
            mode: { _enum: "blendMode", _value: "overlay" }
          }
        }], { synchronousExecution: true });
        
        // 作成したレイヤーを確実にアクティブにする
        await action.batchPlay([{
          _obj: "select",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          makeVisible: true
        }], { synchronousExecution: true });
        console.log("✓ Dark grain layer created and selected");
      } catch (e) {
        console.error("Layer creation failed:", e);
        throw new Error("レイヤー作成に失敗しました");
      }
      
      // 5) 選択を一時解除して全選択、50%グレーで塗りつぶし
      try {
        await action.batchPlay([{
          _obj: "selectAll"
        }], { synchronousExecution: true });
        
        // JSXと同じFill方式
        await action.batchPlay([{
          _obj: "fill",
          using: { _enum: "fillContents", _value: "gray" },
          mode: { _enum: "blendMode", _value: "normal" },
          opacity: { _unit: "percentUnit", _value: 100 }
        }], { synchronousExecution: true });
        console.log("✓ Layer filled with 50% gray");
      } catch (e) {
        console.error("Gray fill failed:", e);
        throw new Error("グレー塗りつぶしに失敗しました");
      }
      
      // 6) 保存した選択範囲を正確に復元（JSXのdoc.selection.loadと同等）
      try {
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _name: "__shadowSelectionMask" }
        }], { synchronousExecution: true });
        console.log("✓ Original selection restored accurately");
      } catch (e) {
        console.error("Selection restoration failed:", e);
        throw new Error("選択範囲の復元に失敗しました");
      }
      
      // 7) 全選択してノイズを適用（JSXと同じ手順）
      try {
        await action.batchPlay([{
          _obj: "selectAll"
        }], { synchronousExecution: true });
        
        await action.batchPlay([{
          _obj: "addNoise",
          amount: { _unit: "percentUnit", _value: config.grainAmount },
          distribution: { _enum: "distribution", _value: "gaussian" },
          monochromatic: true
        }], { synchronousExecution: true });
        console.log(`✓ Noise applied: ${config.grainAmount}%`);
      } catch (e) {
        console.error("Noise application failed:", e);
        throw new Error("ノイズ適用に失敗しました");
      }
      
      // 8) 保存した選択範囲を再度復元
      try {
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _name: "__shadowSelectionMask" }
        }], { synchronousExecution: true });
        console.log("✓ Selection restored for mask creation");
      } catch (e) {
        console.error("Selection restoration for mask failed:", e);
        throw new Error("マスク用選択範囲の復元に失敗しました");
      }
      
      // 9) レイヤーマスクを作成（JSXと同じHide Selection方式）
      try {
        await action.batchPlay([{
          _obj: "make",
          new: { _class: "channel" },
          at: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          using: { _enum: "userMaskEnabled", _value: "hideSelection" } // JSXと同じHdSl
        }], { synchronousExecution: true });
        console.log("✓ Layer mask created with hide selection");
      } catch (e) {
        console.error("Mask creation failed:", e);
        throw new Error("レイヤーマスク作成に失敗しました");
      }
      
      // 10) 不透明度を100%に設定（JSXと同じ）
      try {
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: {
            _obj: "layer",
            opacity: { _unit: "percentUnit", _value: 100 }
          }
        }], { synchronousExecution: true });
        console.log("✓ Opacity set to 100%");
      } catch (e) {
        console.error("Opacity setting failed:", e);
      }
      
      // 11) 一時チャンネルを削除
      try {
        await action.batchPlay([{
          _obj: "delete",
          _target: [{ _ref: "channel", _name: "__shadowSelectionMask" }]
        }], { synchronousExecution: true });
        console.log("✓ Temporary channel cleaned up");
      } catch (e) {
        console.error("Channel cleanup failed:", e);
      }
      
      // 12) 選択を解除
      try {
        await action.batchPlay([{
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _enum: "ordinal", _value: "none" }
        }], { synchronousExecution: true });
        console.log("✓ Selection cleared");
      } catch (e) {
        console.error("Selection clear failed:", e);
      }
      
      console.log(`📽️ Dark grain effect applied successfully (grain: ${config.grainAmount}%)`);
      
    } catch (e) {
      console.error("applyDarkGrainEffect error:", e);
      throw new Error(`暗部グレイン効果の適用に失敗: ${e.message}`);
    }
  }
});