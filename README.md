# Pug mixin image dimension
## 概要（Overview）

この VS Code 拡張は、**Pug（Jade）で記述された mixin 呼び出しから画像ファイルを解析し、実際の画像サイズ（width / height）を自動挿入する**ためのツールです。
画像パスはファイル名のみを指定する運用を前提とし、ローカルの実体画像からサイズを取得します。

`+img` や `+picture`、配列データを受け取る独自 mixin など、**プロジェクト固有の書き方にも設定だけで対応**できます。

---

## 仕様・使い方

### 基本機能

* カーソル位置の **mixin 呼び出し**を検出
* 指定された画像ファイルを探索し、実際の **画像サイズを取得**
* `width / height`（必要に応じて `widthSp / heightSp`）を自動挿入
* 実寸サイズ／半分サイズを **コマンドまたはショートカットで選択可能**

### ショートカット（変更可能）
- `ctrl + alt + 1` = 実寸サイズ
- `ctrl + alt + 2` = 半分サイズ

---

### 対応する書き方

#### 1. imgArgs（引数順序）形式

```pug
+img("sample.jpg","")
```

→ `width, height` を自動で追加

```pug
+img("sample.jpg", "", 800, 600)
```

---

#### 2. pictureOpts（オブジェクトキー名） 形式（PC / SP 対応）

```pug
+picture({ imagePc: "pc.jpg", imageSp: "sp.jpg" })
```

→

* PC画像 → `width / height`
* SP画像 → `widthSp / heightSp`

※ 片方だけ指定されている場合も、その分だけ処理されます。

---

#### 3. dataArray（配列データ）形式

```pug
+c_cards([
  { imagePc: "a.jpg", imageSp: "b.jpg", title: "Sample" }
])
```

→ 各要素ごとに、存在する画像分のサイズを挿入

```pug
{
  imagePc: "a.jpg",
  imageSp: "b.jpg",
  width: 800,
  height: 600,
  widthSp: 375,
  heightSp: 250
}
```

---

## 設定による拡張性

* **対象 mixin 名**
* **画像キー名（imagePc / imageSp など）**
* **挿入する width / height のキー名**

をすべて **設定ファイル（settings.json）で定義可能**です。

これにより、プロジェクトごとに異なる命名規則や mixin 構造にも、プラグインの改修なしで対応できます。


### 設定のポイント
#### 1. imgArgs（引数順序）の変更
   もし +img(file, width, height, alt) のように alt を最後にしている場合は、以下のようにインデックスを調整してください。
```
{
  "name": "img",
  "type": "imgArgs",
  "widthIndex": 1,
  "heightIndex": 2,
  "altIndex": 3
}
```

#### 2. pictureOpts（オブジェクトキー名）の変更
   例えば、SP用のキーを sp ではなく mobile にしたい、あるいは widthSp ではなく wSp にしたいといった場合は、該当するキー名を指定します。
```
{
  "name": "picture",
  "type": "pictureOpts",
  "pcKey": "pc",
  "pcWidthKey": "w",
  "pcHeightKey": "h",
  "spKey": "mobile",
  "spWidthKey": "wSp",
  "spHeightKey": "hSp"
}
```
#### 3.dataArray（配列データ）形式
例えば、SP用のキーを sp ではなく mobile にしたい、あるいは widthSp ではなく wSp にしたいといった場合は、該当するキー名を指定します。
```
{
  "name": "c_cards",
  "type": "dataArray",
  "sources": [
    {
      "imageKey": "image",
      "widthKey": "width",
      "heightKey": "height"
    },
    {
      "imageKey": "imageSp",
      "widthKey": "widthSp",
      "heightKey": "heightSp"
    }
  ]
}

```

---

## 注意事項・制限

* 画像パスは **文字列リテラルのみ対応**（変数・式は対象外）
* dataArray では **配列／オブジェクト直書きのみ対応**
* 対象画像はローカルファイル（imagesRoot 配下）に存在している必要があります

---

## 想定される利用シーン

* デザイン通りの `width / height` を手入力したくない
* Pug の mixin を使ったコンポーネント設計をしている
* PC / SP 画像を分けて管理している
* プロジェクトごとに画像キー名が揺れる環境

