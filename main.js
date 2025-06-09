// 完全UXP版 main.js — LUTテンプレート＆写真適用フロー

const uxp       = require("uxp");
const fs        = uxp.storage.localFileSystem;
const { app, core, action, constants } = require("photoshop");

document.addEventListener("DOMContentLoaded", () => {
  const createTemplateBtn = document.getElementById("createTemplateBtn");
  const applyToPhotoBtn   = document.getElementById("applyToPhotoBtn");
  const applyFilmBtn      = document.getElementById("applyFilmBtn");
  const deleteHiddenLayersBtn = document.getElementById("deleteHiddenLayersBtn");
  const statusDiv         = document.getElementById("status");

  createTemplateBtn.addEventListener("click", createLutTemplate);
  applyToPhotoBtn  .addEventListener("click", applyToPhoto);
  applyFilmBtn     .addEventListener("click", applyAdvancedFilmEffects);
  deleteHiddenLayersBtn.addEventListener("click", deleteHiddenLayers);

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
      color: { r: 220, g: 89, b: 1 }, // オレンジ色 (#dc5901)
      overlayOpacity: 15     // オーバーレイレイヤーの不透明度（かなり控えめに）
    },
    dreamyHaze: {
      enabled: true,
      name: "Dreamy Haze",
      // メインのぼかし効果
      blur: {
        radius: 30,
        blendMode: "screen",
        opacity: 20
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
        
        // 📋 STEP 1: エフェクト適用前の既存レイヤーIDを記録
        const doc = app.activeDocument;
        const existingLayerIds = new Set();
        
        console.log("🔧 DEBUG: Recording existing layers before effects...");
        for (const layer of doc.layers) {
          existingLayerIds.add(layer.id);
          console.log(`🔧 DEBUG: Existing layer - id: ${layer.id}, name: "${layer.name}"`);
        }
        
        // 再グループ化戦略による確実なレイヤー移動関数
        async function moveNewLayersToGroup(groupLayer, existingIds) {
          if (!groupLayer) return 0;
          
          console.log("🔧 DEBUG: Looking for newly created layers...");
          const currentLayers = app.activeDocument.layers;
          const newLayers = [];
          
          for (const layer of currentLayers) {
            if (!existingIds.has(layer.id) && layer.id !== groupLayer.id) {
              newLayers.push(layer);
              console.log(`🔧 DEBUG: Found new layer - id: ${layer.id}, name: "${layer.name}"`);
            }
          }
          
          if (newLayers.length === 0) {
            console.log("🔧 DEBUG: No new layers to move");
            return 0;
          }
          
          console.log(`🔧 DEBUG: Implementing re-grouping strategy for ${newLayers.length} layers...`);
          
          try {
            // 既存グループのプロパティを保存
            const groupProps = {
              name: groupLayer.name,
              opacity: groupLayer.opacity,
              blendMode: groupLayer.blendMode,
              visible: groupLayer.visible
            };
            
            console.log(`🔧 DEBUG: Saved group properties - name: "${groupProps.name}"`);
            
            // 既存グループの子レイヤーを取得
            const existingChildren = Array.from(groupLayer.layers || []);
            console.log(`🔧 DEBUG: Found ${existingChildren.length} existing children in group`);
            
            // 新しいグループに含める全レイヤーの配列を作成（新規レイヤーを追加）
            const combinedLayers = [...existingChildren, ...newLayers];
            console.log(`🔧 DEBUG: Combined layers total: ${combinedLayers.length}`);
            
            // 元のグループを削除
            console.log(`🔧 DEBUG: Deleting original group...`);
            await groupLayer.delete();
            
            // 新しいグループを作成
            console.log(`🔧 DEBUG: Creating new group with ${combinedLayers.length} layers...`);
            const newGroup = await app.activeDocument.createLayerGroup({
              name: groupProps.name,
              fromLayers: combinedLayers,
              opacity: groupProps.opacity,
              blendMode: groupProps.blendMode
            });
            
            // 可視性を再適用
            newGroup.visible = groupProps.visible;
            
            console.log(`✅ Successfully re-grouped ${newLayers.length} new layers into "${groupProps.name}"`);
            return newLayers.length;
            
          } catch (e) {
            console.error(`❌ Re-grouping strategy failed:`, e);
            return 0;
          }
        }
        
        // ベースレイヤーを記録（各エフェクトはこのレイヤーを基準に適用）
        let baseLayerName = "Background"; // デフォルト値
        
        try {
          if (doc.layers && doc.layers.length > 0) {
            // 最初のレイヤーを使用
            baseLayerName = doc.layers[0].name;
          }
        } catch (e) {
          console.log("レイヤー名取得エラー、デフォルト値使用:", e.message);
        }
        
        console.log("📐 Base layer:", baseLayerName);
        
        // 📋 STEP 2: 各エフェクトを適用（グループなし状態）
        console.log("🎬 Applying all film effects without grouping...");
        
        // ハレーション効果
        if (FILM_EFFECTS_CONFIG.halation.enabled) {
          console.log("✨ Applying halation effect...");
          await selectBottomLayer();
          await applyHalationEffect();
        }
        
        // Dreamy Haze効果
        if (FILM_EFFECTS_CONFIG.dreamyHaze.enabled) {
          console.log("🌙 Applying dreamy haze effect...");
          await selectBottomLayer();
          await applyDreamyHazeEffect();
        }
        
        // 暗部グレイン効果
        if (FILM_EFFECTS_CONFIG.darkGrain.enabled) {
          console.log("📽️ Applying dark grain effect...");
          await selectBottomLayer();
          await applyDarkGrainEffect();
        }
        
        // 📋 STEP 3: すべてのエフェクト適用後、Film Effectsグループを作成
        let filmEffectsGroup = null;
        if (FILM_EFFECTS_CONFIG.organization.useGroups) {
          console.log("🔧 DEBUG: Creating Film Effects group after all effects...");
          filmEffectsGroup = await getOrCreateFilmEffectsGroup();
        }
        
        // 📋 STEP 4: 新規作成されたレイヤーのみをグループに移動
        if (filmEffectsGroup) {
          console.log("🔧 DEBUG: Moving only newly created film effect layers to group...");
          const movedCount = await moveNewLayersToGroup(filmEffectsGroup, existingLayerIds);
          console.log(`✅ Successfully moved ${movedCount} newly created film effect layers to group`);
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
      console.log("🔧 DEBUG: Selecting bottom layer for effect base...");
      
      // Original Imageレイヤーを探して選択
      const doc = app.activeDocument;
      for (const layer of doc.layers) {
        if (layer.name === "Original Image" && layer.kind === constants.LayerKind.PIXEL) {
          console.log(`🔧 DEBUG: Found Original Image layer - id: ${layer.id}`);
          await action.batchPlay([{
            _obj: "select",
            _target: [{ _ref: "layer", _id: layer.id }]
          }], { synchronousExecution: true });
          console.log("✓ Original Image layer selected");
          return;
        }
      }
      
      // Original Imageが見つからない場合は最下位レイヤーを選択
      console.log("🔧 DEBUG: Original Image not found, selecting bottom layer");
      await action.batchPlay([{
        _obj: "select",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "back" }]
      }], { synchronousExecution: true });
      console.log("✓ Bottom layer selected");
      
    } catch (e) {
      console.error("❌ Layer selection error:", e.message);
    }
  }

  // ── Film Effectsグループを取得または作成する関数 ──
  async function getOrCreateFilmEffectsGroup() {
    console.log("🔧 DEBUG: getOrCreateFilmEffectsGroup starting...");
    
    try {
      // 1) 既存のFilm Effectsグループを検索
      const doc = app.activeDocument;
      console.log(`🔧 DEBUG: Document has ${doc.layers.length} layers`);
      
      for (let i = 0; i < doc.layers.length; i++) {
        const layer = doc.layers[i];
        console.log(`🔧 DEBUG: Layer ${i}: "${layer.name}" (kind: ${layer.kind}, id: ${layer.id})`);
        
        if (layer.kind === constants.LayerKind.GROUP && layer.name === "Film Effects") {
          console.log("✅ Found existing Film Effects group, reusing it");
          console.log(`🔧 DEBUG: Existing group - id: ${layer.id}, name: "${layer.name}"`);
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
      
      // 作成したグループを正しく取得
      console.log("🔧 DEBUG: Searching for newly created Film Effects group...");
      
      // グループ作成後に再度検索して正しいグループを見つける
      for (const layer of doc.layers) {
        console.log(`🔧 DEBUG: Checking layer - id: ${layer.id}, name: "${layer.name}", kind: ${layer.kind}`);
        if (layer.kind === constants.LayerKind.GROUP && layer.name === "Film Effects") {
          console.log(`✅ Found correct Film Effects group - id: ${layer.id}, name: "${layer.name}"`);
          return layer;
        }
      }
      
      console.error("❌ Could not find created Film Effects group!");
      return null;
      
    } catch (e) {
      console.error("getOrCreateFilmEffectsGroup error:", e);
      return null;
    }
  }

  // 注: BatchPlay moveは信頼性が低いため、再グループ化戦略に移行

  // 注: BatchPlay moveは信頼性の問題により削除。再グループ化戦略を使用。

  // ── フィルムエフェクト設定ダイアログ関数 ──
  async function showThresholdDialog() {
    return new Promise((resolve, reject) => {
      const dialog = document.getElementById('thresholdDialog');
      
      try {
        console.log("🔧 DEBUG: Creating custom sliders...");
        
        // カスタムスライダーのインスタンスを保持
        const sliders = {};
        
        // ハレーション設定のスライダー
        const thresholdContainer = document.getElementById('thresholdSliderContainer');
        console.log("🔧 DEBUG: thresholdContainer:", thresholdContainer);
        
        sliders.threshold = new CustomSlider(
          thresholdContainer,
          {
            label: '閾値',
            min: 100,
            max: 250,
            step: 5,
            value: FILM_EFFECTS_CONFIG.halation.threshold
          }
        );
        console.log("🔧 DEBUG: threshold slider created");
      
        sliders.blurRadius = new CustomSlider(
          document.getElementById('blurRadiusSliderContainer'),
          {
            label: 'ぼかし半径 (px)',
            min: 10,
            max: 100,
            step: 5,
            value: FILM_EFFECTS_CONFIG.halation.blurRadius
          }
        );
        console.log("🔧 DEBUG: blurRadius slider created");
      
        // Dreamy Haze設定のスライダー
        sliders.dreamyBlurRadius = new CustomSlider(
          document.getElementById('dreamyBlurRadiusSliderContainer'),
          {
            label: 'ぼかし半径 (px)',
            min: 10,
            max: 100,
            step: 5,
            value: FILM_EFFECTS_CONFIG.dreamyHaze.blur.radius
          }
        );
        console.log("🔧 DEBUG: dreamyBlurRadius slider created");
        
        sliders.dreamyBlurOpacity = new CustomSlider(
          document.getElementById('dreamyBlurOpacitySliderContainer'),
          {
            label: 'ぼかしレイヤー不透明度 (%)',
            min: 0,
            max: 100,
            step: 5,
            value: FILM_EFFECTS_CONFIG.dreamyHaze.blur.opacity
          }
        );
        console.log("🔧 DEBUG: dreamyBlurOpacity slider created");
        
        sliders.dreamyGradientOpacity = new CustomSlider(
          document.getElementById('dreamyGradientOpacitySliderContainer'),
          {
            label: 'グラデーションマップ不透明度 (%)',
            min: 0,
            max: 50,
            step: 1,
            value: FILM_EFFECTS_CONFIG.dreamyHaze.gradientMap.opacity
          }
        );
        console.log("🔧 DEBUG: dreamyGradientOpacity slider created");
      
        // 暗部グレイン設定のスライダー
        sliders.shadowThreshold = new CustomSlider(
          document.getElementById('shadowThresholdSliderContainer'),
          {
            label: '暗部しきい値',
            min: 0,
            max: 255,
            step: 5,
            value: FILM_EFFECTS_CONFIG.darkGrain.shadowThreshold
          }
        );
        console.log("🔧 DEBUG: shadowThreshold slider created");
        
        sliders.grainAmount = new CustomSlider(
          document.getElementById('grainAmountSliderContainer'),
          {
            label: 'グレイン量 (%)',
            min: 1,
            max: 50,
            step: 1,
            value: FILM_EFFECTS_CONFIG.darkGrain.grainAmount
          }
        );
        console.log("🔧 DEBUG: grainAmount slider created");
        
        sliders.featherRadius = new CustomSlider(
          document.getElementById('featherRadiusSliderContainer'),
          {
            label: 'マスクのフェザー (px)',
            min: 0,
            max: 50,
            step: 2,
            value: FILM_EFFECTS_CONFIG.darkGrain.featherRadius
          }
        );
        console.log("🔧 DEBUG: featherRadius slider created");
        console.log("🔧 DEBUG: All sliders created successfully");
      
      // チェックボックス要素の取得
      const enableHalation = document.getElementById('enableHalation');
      const enableDreamyHaze = document.getElementById('enableDreamyHaze');
      const dreamyToneCurve = document.getElementById('dreamyToneCurve');
      const dreamyGradientMap = document.getElementById('dreamyGradientMap');
      const enableDarkGrain = document.getElementById('enableDarkGrain');
      
      const cancelBtn = document.getElementById('cancelBtn');
      const applyBtn = document.getElementById('applyBtn');
      
      // チェックボックスの初期値を設定
      enableHalation.checked = FILM_EFFECTS_CONFIG.halation.enabled;
      enableDreamyHaze.checked = FILM_EFFECTS_CONFIG.dreamyHaze.enabled;
      dreamyToneCurve.checked = FILM_EFFECTS_CONFIG.dreamyHaze.toneCurve.enabled;
      dreamyGradientMap.checked = FILM_EFFECTS_CONFIG.dreamyHaze.gradientMap.enabled;
      enableDarkGrain.checked = FILM_EFFECTS_CONFIG.darkGrain.enabled;
      
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
          threshold: sliders.threshold.value,
          blurRadius: sliders.blurRadius.value,
          // Dreamy Haze設定
          dreamyHaze: {
            enabled: enableDreamyHaze.checked,
            blurRadius: sliders.dreamyBlurRadius.value,
            blurOpacity: sliders.dreamyBlurOpacity.value,
            enableToneCurve: dreamyToneCurve.checked,
            enableGradientMap: dreamyGradientMap.checked,
            gradientMapOpacity: sliders.dreamyGradientOpacity.value
          },
          // グレイン設定
          darkGrainEnabled: enableDarkGrain.checked,
          shadowThreshold: sliders.shadowThreshold.value,
          grainAmount: sliders.grainAmount.value,
          featherRadius: sliders.featherRadius.value
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
        // カスタムスライダーのクリーンアップ
        Object.values(sliders).forEach(slider => slider.destroy());
        
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
        
      } catch (error) {
        console.error("🔧 DEBUG: showThresholdDialog error:", error);
        reject(error);
      }
    });
  }

  // ── ハレーション効果の適用（ExtendScript版互換） ──
  async function applyHalationEffect() {
    try {
      console.log("🌟 Creating precise halation effect (ExtendScript style)...");
      
      const config = FILM_EFFECTS_CONFIG.halation;
      
      // 1) レイヤーを複製
      console.log(`🔧 DEBUG: Creating "${config.name} Base" layer...`);
      await action.batchPlay([{
        _obj: "duplicate",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        name: config.name + " Base",
        version: 5
      }], { synchronousExecution: true });
      
      console.log(`✓ Halation Base layer created`);
      
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
      console.log(`🔧 DEBUG: Creating "${config.name} Color" layer...`);
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
              green: config.color.g,
              blue: config.color.b
            }
          }
        }
      }], { synchronousExecution: true });
      
      console.log(`✓ Halation Color layer created`);
      
      // 5.5) レイヤー順序の確認と修正
      // Halation ColorがHalation Baseの直上にあることを確認
      const doc = app.activeDocument;
      let colorLayer = null;
      let baseLayer = null;
      
      // レイヤーを探す
      for (const layer of doc.layers) {
        if (layer.name === config.name + " Color") colorLayer = layer;
        if (layer.name === config.name + " Base") baseLayer = layer;
      }
      
      if (colorLayer && baseLayer) {
        // レイヤーのインデックスを確認
        const allLayers = Array.from(doc.layers);
        const colorIndex = allLayers.indexOf(colorLayer);
        const baseIndex = allLayers.indexOf(baseLayer);
        
        console.log(`🔧 DEBUG: Color layer index: ${colorIndex}, Base layer index: ${baseIndex}`);
        
        // Photoshopではインデックスが小さいほど上位
        if (colorIndex !== baseIndex - 1) {
          console.log("⚠️ レイヤー順序が正しくありません。修正を試みます...");
          // 必要に応じてレイヤーを移動するロジックをここに追加
        }
      }
      
      // 6) 塗りつぶしレイヤーの描画モードをオーバーレイに変更
      await action.batchPlay([{
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: {
          _obj: "layer",
          mode: { _enum: "blendMode", _value: "overlay" },
          opacity: { _unit: "percentUnit", _value: config.overlayOpacity }
        }
      }], { synchronousExecution: true });
      
      // 6.5) Halation Colorレイヤーを明示的にアクティブにする
      console.log("🔧 DEBUG: Making Halation Color layer active for clipping mask...");
      const colorLayerForSelection = app.activeDocument.layers.find(l => l.name === config.name + " Color");
      if (colorLayerForSelection) {
        app.activeDocument.activeLayers = [colorLayerForSelection];
        console.log(`✓ Halation Color layer is now active (id: ${colorLayerForSelection.id})`);
      }
      
      // 7) クリッピングマスクを作成（DOM APIを使用）
      console.log("Creating clipping mask using DOM API...");
      
      // 最新のレイヤー状態を取得
      const currentDoc = app.activeDocument;
      let targetColorLayer = null;
      
      // Halation Colorレイヤーを探す
      for (const layer of currentDoc.layers) {
        if (layer.name === config.name + " Color") {
          targetColorLayer = layer;
          break;
        }
      }
      
      if (targetColorLayer) {
        try {
          // DOM APIを使用してクリッピングマスクを設定
          if (!targetColorLayer.isClippingMask) {
            targetColorLayer.isClippingMask = true;
            console.log(`✅ Clipping mask created successfully using DOM API`);
          } else {
            console.log(`ℹ️ Layer is already a clipping mask`);
          }
        } catch (e) {
          console.error("DOM API failed, trying batchPlay fallback:", e);
          
          // フォールバック: groupEventを使用
          await action.batchPlay([{
            _obj: "groupEvent",
            _target: [{ _ref: "layer", _id: targetColorLayer.id }]
          }], { synchronousExecution: true });
          
          console.log(`✅ Clipping mask created using groupEvent fallback`);
        }
      } else {
        console.error("❌ Could not find Halation Color layer for clipping mask");
      }
      
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

  // ── 非表示レイヤー削除機能 ──
  async function deleteHiddenLayers() {
    console.log("▶ deleteHiddenLayers start");
    
    if (!app.activeDocument) {
      showAlert("最初に写真を開いてください。");
      return;
    }

    try {
      updateStatus("非表示レイヤーを検索中...");
      
      // 非表示レイヤーを検出
      const hiddenLayers = await findHiddenLayers();
      console.log(`🔍 Found ${hiddenLayers.length} hidden layers`);
      
      if (hiddenLayers.length === 0) {
        showAlert("削除対象の非表示レイヤーがありません。");
        updateStatus("");
        return;
      }

      // 削除対象をフィルタリング
      const deletableLayers = filterDeletableLayers(hiddenLayers);
      console.log(`📝 Deletable layers: ${deletableLayers.length}`);
      
      if (deletableLayers.length === 0) {
        showAlert("削除可能な非表示レイヤーがありません。<br>（背景レイヤーやロックレイヤーは除外されます）");
        updateStatus("");
        return;
      }

      // 確認ダイアログを表示
      const confirmed = await showDeleteConfirmDialog(deletableLayers.length);
      if (!confirmed) {
        updateStatus("処理がキャンセルされました");
        return;
      }

      // 削除実行
      await executeLayerDeletion(deletableLayers);
      
      updateStatus(`${deletableLayers.length}個の非表示レイヤーを削除しました`);
      showAlert(`${deletableLayers.length}個の非表示レイヤーを削除しました。`);
      
    } catch (e) {
      console.error("deleteHiddenLayers error:", e);
      updateStatus("エラーが発生しました");
      showAlert("非表示レイヤーの削除中にエラーが発生しました:<br>" + e.message);
    }
  }

  // ── 非表示レイヤー検出関数 ──
  async function findHiddenLayers() {
    const hiddenLayers = [];
    const doc = app.activeDocument;
    
    function collectHiddenLayers(layers) {
      for (const layer of layers) {
        // 非表示レイヤーをチェック
        if (!layer.visible) {
          hiddenLayers.push(layer);
        }
        
        // グループレイヤーの場合は再帰的に検索
        if (layer.kind === constants.LayerKind.GROUP && layer.layers) {
          collectHiddenLayers(layer.layers);
        }
      }
    }
    
    collectHiddenLayers(doc.layers);
    return hiddenLayers;
  }

  // ── 削除対象フィルタリング関数 ──
  function filterDeletableLayers(hiddenLayers) {
    return hiddenLayers.filter(layer => {
      // 背景レイヤーは除外
      if (layer.isBackgroundLayer) {
        console.log(`Excluding background layer: ${layer.name}`);
        return false;
      }
      
      // ロックされたレイヤーは除外
      if (layer.locked) {
        console.log(`Excluding locked layer: ${layer.name}`);
        return false;
      }
      
      // 重要なレイヤー名パターンは除外
      const protectedNames = ['background', 'レイヤー 0', '背景'];
      const layerNameLower = layer.name.toLowerCase();
      if (protectedNames.some(name => layerNameLower.includes(name.toLowerCase()))) {
        console.log(`Excluding protected layer: ${layer.name}`);
        return false;
      }
      
      return true;
    });
  }

  // ── 削除確認ダイアログ表示 ──
  async function showDeleteConfirmDialog(layerCount) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('deleteConfirmDialog');
      const deleteCountSpan = document.getElementById('deleteCount');
      const deleteCancelBtn = document.getElementById('deleteCancelBtn');
      const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
      
      // 削除対象数を表示
      deleteCountSpan.textContent = layerCount;
      
      const handleCancel = () => {
        dialog.close();
        cleanup();
        resolve(false);
      };
      
      const handleConfirm = (e) => {
        e.preventDefault();
        dialog.close();
        cleanup();
        resolve(true);
      };
      
      const form = dialog.querySelector('form');
      const handleSubmit = (e) => {
        e.preventDefault();
        handleConfirm(e);
      };
      
      const cleanup = () => {
        deleteCancelBtn.removeEventListener('click', handleCancel);
        deleteConfirmBtn.removeEventListener('click', handleConfirm);
        form.removeEventListener('submit', handleSubmit);
      };
      
      // イベントリスナーを追加
      deleteCancelBtn.addEventListener('click', handleCancel);
      deleteConfirmBtn.addEventListener('click', handleConfirm);
      form.addEventListener('submit', handleSubmit);
      
      // ダイアログを表示
      dialog.showModal();
    });
  }

  // ── 削除実行処理 ──
  async function executeLayerDeletion(layersToDelete) {
    try {
      await core.executeAsModal(async () => {
        console.log(`🗑️ Deleting ${layersToDelete.length} layers...`);
        
        for (let i = 0; i < layersToDelete.length; i++) {
          const layer = layersToDelete[i];
          try {
            console.log(`Deleting layer: ${layer.name}`);
            
            // UXP APIを使用してレイヤーを削除
            await action.batchPlay([{
              _obj: "delete",
              _target: [{ _ref: "layer", _id: layer.id }]
            }], { synchronousExecution: true });
            
          } catch (layerError) {
            console.error(`Failed to delete layer ${layer.name}:`, layerError);
            // 個別レイヤーの削除失敗は続行
          }
        }
        
        console.log("✅ Layer deletion completed");
      }, { commandName: "Delete Hidden Layers" });
      
    } catch (error) {
      console.error("executeLayerDeletion error:", error);
      throw new Error(`レイヤー削除処理に失敗: ${error.message}`);
    }
  }

// ── カスタムスライダークラス ──
class CustomSlider {
  constructor(container, options = {}) {
    this.container = container;
    this.min = options.min || 0;
    this.max = options.max || 100;
    this.step = options.step || 1;
    this.value = options.value || 50;
    this.label = options.label || '';
    this.onChange = options.onChange || (() => {});
    this.onInput = options.onInput || (() => {});
    
    this.isDragging = false;
    this.pointerId = null;
    
    this.init();
  }
    
  init() {
    if (!this.container) {
      throw new Error('CustomSlider: container is required');
    }
    
    // UXP環境対応: JavaScriptで直接DOM要素を構築
    console.log("🔧 DEBUG: Creating slider elements programmatically...");
    
    // メインのラッパー要素
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'custom-slider-wrapper';
    
    // ヘッダー部分
    const sliderHeader = document.createElement('div');
    sliderHeader.className = 'slider-header';
    
    this.labelElement = document.createElement('label');
    this.labelElement.className = 'slider-label';
    
    this.valueDisplay = document.createElement('span');
    this.valueDisplay.className = 'slider-value';
    this.valueDisplay.textContent = '0';
    
    sliderHeader.appendChild(this.labelElement);
    sliderHeader.appendChild(this.valueDisplay);
    
    // スライダーコンテナ
    this.sliderContainer = document.createElement('div');
    this.sliderContainer.className = 'custom-slider-container';
    this.sliderContainer.setAttribute('role', 'slider');
    this.sliderContainer.setAttribute('tabindex', '0');
    
    // トラック
    this.track = document.createElement('div');
    this.track.className = 'slider-track';
    
    // フィル
    this.fill = document.createElement('div');
    this.fill.className = 'slider-fill';
    
    // ハンドル
    this.handle = document.createElement('div');
    this.handle.className = 'slider-handle';
    
    // 要素の組み立て
    this.track.appendChild(this.fill);
    this.track.appendChild(this.handle);
    this.sliderContainer.appendChild(this.track);
    this.wrapper.appendChild(sliderHeader);
    this.wrapper.appendChild(this.sliderContainer);
    
    console.log("🔧 DEBUG: Elements created successfully");
    
    // 初期設定
    this.labelElement.textContent = this.label;
    this.sliderContainer.setAttribute('aria-label', this.label);
    this.sliderContainer.setAttribute('aria-valuemin', this.min);
    this.sliderContainer.setAttribute('aria-valuemax', this.max);
    
    // コンテナに追加
    this.container.appendChild(this.wrapper);
    
    // 初期値を設定
    this.setValue(this.value);
    
    // イベントリスナーを設定
    this.bindEvents();
  }
    
    bindEvents() {
      // ポインターイベント
      this.handle.addEventListener('pointerdown', this.onPointerDown.bind(this));
      this.track.addEventListener('pointerdown', this.onTrackClick.bind(this));
      
      // キーボードイベント
      this.sliderContainer.addEventListener('keydown', this.onKeyDown.bind(this));
    }
    
  onPointerDown(e) {
    e.preventDefault();
    this.isDragging = true;
    this.pointerId = e.pointerId;
    
    // ポインターキャプチャを設定
    this.handle.setPointerCapture(this.pointerId);
    
    // グローバルイベントリスナーを追加
    this.handle.addEventListener('pointermove', this.boundPointerMove = this.onPointerMove.bind(this));
    this.handle.addEventListener('pointerup', this.boundPointerUp = this.onPointerUp.bind(this));
    this.handle.addEventListener('pointercancel', this.boundPointerUp);
  }
    
  onPointerMove(e) {
    if (!this.isDragging) return;
    
    e.preventDefault();
    const rect = this.track.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const rawValue = this.min + (this.max - this.min) * percent;
    
    // ステップに合わせて値を調整
    const steppedValue = Math.round(rawValue / this.step) * this.step;
    const clampedValue = Math.max(this.min, Math.min(this.max, steppedValue));
    
    this.updateValue(clampedValue);
  }
  
  onPointerUp(e) {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    
    // ポインターキャプチャを解放
    this.handle.releasePointerCapture(this.pointerId);
    
    // イベントリスナーを削除
    this.handle.removeEventListener('pointermove', this.boundPointerMove);
    this.handle.removeEventListener('pointerup', this.boundPointerUp);
    this.handle.removeEventListener('pointercancel', this.boundPointerUp);
    
    // 最終的な値でchangeイベントを発火
    this.onChange(this.value);
  }
    
    onTrackClick(e) {
      if (e.target === this.handle) return;
      
      const rect = this.track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(x / rect.width, 1));
      const rawValue = this.min + (this.max - this.min) * percent;
      
      // ステップに合わせて値を調整
      const steppedValue = Math.round(rawValue / this.step) * this.step;
      const clampedValue = Math.max(this.min, Math.min(this.max, steppedValue));
      
      this.setValue(clampedValue);
      this.onChange(this.value);
    }
    
    onKeyDown(e) {
      let newValue = this.value;
      const largeStep = this.step * 10;
      
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          newValue = Math.max(this.min, this.value - this.step);
          e.preventDefault();
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          newValue = Math.min(this.max, this.value + this.step);
          e.preventDefault();
          break;
        case 'Home':
          newValue = this.min;
          e.preventDefault();
          break;
        case 'End':
          newValue = this.max;
          e.preventDefault();
          break;
        case 'PageUp':
          newValue = Math.min(this.max, this.value + largeStep);
          e.preventDefault();
          break;
        case 'PageDown':
          newValue = Math.max(this.min, this.value - largeStep);
          e.preventDefault();
          break;
        default:
          return;
      }
      
      if (newValue !== this.value) {
        this.setValue(newValue);
        this.onChange(this.value);
      }
    }
    
    updateValue(value) {
      if (this.value !== value) {
        this.value = value;
        this.updateUI();
        this.onInput(value);
      }
    }
    
    setValue(value) {
      this.value = Math.max(this.min, Math.min(this.max, value));
      this.updateUI();
    }
    
    updateUI() {
      const percent = ((this.value - this.min) / (this.max - this.min)) * 100;
      
      // ハンドルとフィルの位置を更新
      this.handle.style.left = `${percent}%`;
      this.fill.style.width = `${percent}%`;
      
      // 値表示とARIA属性を更新
      this.valueDisplay.textContent = this.value;
      this.sliderContainer.setAttribute('aria-valuenow', this.value);
    }
    
  destroy() {
    // クリーンアップ
    this.wrapper.remove();
  }
}
});