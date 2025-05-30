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
  applyFilmBtn     .addEventListener("click", applyFilmLayer);

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
});