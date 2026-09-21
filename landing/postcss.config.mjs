const config = {
    plugins: {
        // v4 moved Tailwind into its own PostCSS plugin, and prefixes itself,
        // so autoprefixer is gone with it.
        "@tailwindcss/postcss": {},
    },
};
export default config;
