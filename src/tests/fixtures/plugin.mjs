import plugin from 'tailwindcss/plugin'

export default plugin(function ({ addUtilities }) {
  addUtilities({ '.custom-plugin-util': { 'text-align': 'center' } })
})
