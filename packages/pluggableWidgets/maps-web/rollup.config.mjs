import { mkdirSync } from "node:fs";
import { fileURLToPath } from "url";
import { join } from "path";
import copyFiles from "@mendix/rollup-web-widgets/copyFiles.mjs";
import postcss from "rollup-plugin-postcss";
import postcssImport from "postcss-import";
import postcssUrl from "postcss-url";

export default async args => {
    // First, call copyFiles to get the default config
    const result = copyFiles(args);

    const [jsConfig, mJsConfig] = result;

    const folderUrl = new URL("dist/tmp/widgets/com/mendix/widget/custom/Maps/", import.meta.url);
    const folderPath = fileURLToPath(folderUrl);

    // create target dir before any bundling to make sure casing is correct:
    // expected: com/mendix/widget/custom/Maps
    mkdirSync(folderPath, { recursive: true });

    // We change the output because maps widget package was wrongly named with uppercase M in the past.
    jsConfig.output.file = fileURLToPath(new URL("Maps.js", folderUrl));
    mJsConfig.output.file = fileURLToPath(new URL("Maps.mjs", folderUrl));

    // Fix CSS asset URLs to use uppercase "Maps" instead of lowercase "maps"
    // This is necessary for case-sensitive filesystems (Linux/Mendix Cloud)
    const production = Boolean(args.configProduction);
    const widgetPackage = "com.mendix.widget.custom";
    const widgetName = "Maps"; // Uppercase to match directory structure
    const assetsDirName = "assets";
    const outWidgetDir = join(widgetPackage.replace(/\./g, "/"), widgetName);
    const outWidgetFile = join(outWidgetDir, widgetName);
    const outDir = join(process.cwd(), "/dist/tmp/widgets/");
    const absoluteOutAssetsDir = join(outDir, outWidgetDir, assetsDirName);

    // Custom CSS URL transform that preserves the uppercase "Maps"
    const cssUrlTransform = asset =>
        asset.url.startsWith(`${assetsDirName}/`) ? `${outWidgetDir.replace(/\\/g, "/")}/${asset.url}` : asset.url;

    // Create our own PostCSS plugin with the correct case
    const customPostCssPlugin = outputFormat => {
        return postcss({
            extensions: [".css", ".sass", ".scss"],
            extract: outputFormat === "amd",
            inject: false,
            minimize: production,
            plugins: [
                postcssImport(),
                postcssUrl({ url: "copy", assetsPath: assetsDirName }),
                postcssUrl({ url: cssUrlTransform }) // Use our custom transform with uppercase Maps
            ],
            sourceMap: !production ? "inline" : false,
            use: ["sass"],
            to: join(outDir, `${outWidgetFile}.css`)
        });
    };

    // Replace the PostCSS plugin in both configs
    [jsConfig, mJsConfig].forEach((config, idx) => {
        const outputFormat = idx === 0 ? "amd" : "es";
        const postcssPluginIndex = config.plugins.findIndex(p => p && p.name === "postcss");

        if (postcssPluginIndex !== -1) {
            config.plugins[postcssPluginIndex] = customPostCssPlugin(outputFormat);
        }
    });

    return result;
};
