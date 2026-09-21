const config = {
    plugins: {
        // v4 moved Tailwind out of the `tailwindcss` plugin and into its own.
        // Autoprefixer is gone: v4 handles prefixing itself, against the
        // browser list it computes from the target.
        "@tailwindcss/postcss": {},
    },
};
export default config;
