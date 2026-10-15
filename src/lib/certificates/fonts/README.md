# Certificate font

`NotoSansSC.ttf` is bundled so certificate generation needs no font downloads or Python tools at runtime. Source: [Google Fonts Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc), `NotoSansSC[wght].ttf`, retrieved 2026-10-01. The SIL Open Font License is included in `NotoSansSC-LICENSE.txt`.

The source was instantiated at weight 400 and its hint instructions removed with FontTools 4.63.0, retaining glyph coverage. The generator uses fontkit 2 to subset the static TrueType outlines. The pdf-lib compatibility adapter supplies its legacy streaming API. Regression checks validate embedded outlines, Unicode text, pagination, demo markings, page bounds and the database storage size limit; visual inspection additionally checks the downloaded PDF.
