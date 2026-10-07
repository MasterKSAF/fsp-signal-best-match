# Manrope for resume PDFs

`Manrope-Regular.ttf` (weight 400) and `Manrope-SemiBold.ttf` (weight 600) are static instances of the project's existing `artifacts/fsp-signal/public/fonts/Manrope-Variable.ttf`.

They are bundled locally so the PDF export works offline, embeds Cyrillic glyphs and does not rely on a server's installed fonts. The upstream SIL Open Font License is included as `manrope-OFL.txt`.

The instances were generated with fontTools 4.66.1 `fontTools.varLib.instancer.instantiateVariableFont` using the `wght` axis. fontTools is a development-time tool; it is not needed to run or build the application.
