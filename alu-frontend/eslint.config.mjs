import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTs,
    {
        rules: {
            "react-hooks/set-state-in-effect": "off",
            "react-hooks/purity": "off",
            "react-hooks/preserve-manual-memoization": "off",
            "react/no-unescaped-entities": "off",
            "@next/next/no-html-link-for-pages": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
    {
        files: ["**/*.js"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    globalIgnores([
        ".next/**",
        "out/**",
        "build/**",
        "next-env.d.ts",
    ]),
]);

export default eslintConfig;
