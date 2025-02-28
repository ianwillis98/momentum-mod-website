const { createGlobPatternsForDependencies } = require('@nx/angular/tailwind');
const { join } = require('node:path');
const plugin = require('tailwindcss/plugin');
const defaultTheme = require('tailwindcss/defaultTheme');
const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    join(__dirname, 'src/**/!(*.stories|*.spec).{ts,html}'),
    ...createGlobPatternsForDependencies(__dirname)
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', ...defaultTheme.fontFamily.sans],
        display: ['Bebas Neue Momentum', ...defaultTheme.fontFamily.sans]
      },
      flexGrow: {
        2: '2',
        3: '3',
        4: '4',
        5: '5',
        6: '6',
        7: '7',
        8: '8',
        9: '9',
        10: '10',
        11: '11',
        12: '12'
      }
    },
    //prettier-ignore
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      black: '#000',
      white: '#fff',

      // Tailwind defaults for now, do custom versions in the future!
      red: colors.red,
      indigo: colors.indigo,
      orange: colors.orange,
      green: colors.green,
      yellow: colors.yellow,

      // Our stuff - all created using https://palettte.app/
      // Very neutral grays, no sat for dark tones, slightly blue for lighter
      gray: {
        50:  '#E7F0F4',
        100: '#D3DFE6',
        200: '#BDCAD1',
        300: '#9BA8AE',
        400: '#737C81',
        500: '#53585B',
        600: '#3C3D3E',
        700: '#242424',
        800: '#1C1C1C',
        900: '#141414',
        950: '#0B0B0B'
      },
      // Very pale blues
      pale: {
        50:  '#B9DEFF',
        100: '#A6CBEF',
        200: '#93B6DB',
        300: '#7D9CC3',
        400: '#6380AB',
        500: '#4E658F',
        600: '#364568',
        700: '#252F48',
        800: '#181D2C',
        900: '#10121A',
        950: '#0A0B0F'
      },
      // Based on our signature blue #1896d3 (sometimes #1795d2) which is 400,
      // then darker tones have a slightly more purpleish hue based on colors
      // in our dark 3D background render
      blue: {
        50:  '#DCEFFF',
        100: '#C0E5FF',
        200: '#A1DCFB',
        300: '#7BCCF5',
        400: '#52B8E9',
        500: '#2A9BDB',
        600: '#1980CA',
        700: '#0E60B6',
        800: '#104298',
        900: '#14337F',
        950: '#122556'
      }
    }
  },
  corePlugins: {
    preflight: true
  },
  plugins: [
    require('@tailwindcss/typography'),
    plugin(function ({ addBase, theme }) {
      addBase({
        h1: { fontSize: theme('fontSize.6xl') },
        h2: { fontSize: theme('fontSize.4xl') },
        h3: { fontSize: theme('fontSize.3xl') },
        h4: { fontSize: theme('fontSize.2xl') },
        h5: { fontSize: theme('fontSize.xl') },
        h6: { fontSize: theme('fontSize.lg') }
      });
    }),
    plugin(function ({ addVariant }) {
      addVariant('valid', '&.ng-valid.ng-dirty');
      addVariant('invalid', '&.ng-invalid.ng-dirty');
      addVariant('pending', '&.ng-pending.ng-dirty');
      // No FF support for :has yet but probably coming in the next year
      addVariant('validchild', '&:has( .ng-valid.ng-dirty)');
      addVariant('invalidchild', '&:has( .ng-invalid.ng-dirty)');
      addVariant('pendingchild', '&:has( .ng-pending.ng-dirty)');
    })
  ],
  safelist: [
    {
      // We set these dynamically in code in some places, treeshaker doesn't
      // pick them up.
      pattern: /text-(red|green|blue|orange|indigo|yellow)/
    }
  ]
};
