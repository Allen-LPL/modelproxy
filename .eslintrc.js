module.exports = {
    root: true,
    extends: 'airbnb-base',
    installedESLint: true,
    plugins: ['import'],
    env: {
      commonjs: true,
      es6: true,
      node: true,
    },
    rules: {
      'no-console': 'off',
      'no-param-reassign': 'off',
      'class-methods-use-this': 'off',
      'no-underscore-dangle': 'off',
      'no-plusplus': 'off',
      'no-lonely-if': 'off',
    },
  };
  