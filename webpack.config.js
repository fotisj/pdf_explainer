const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/renderer/index.js',
  // Not 'electron-renderer': this app runs with nodeIntegration:false/contextIsolation:true
  // (all main-process access goes through the window.electron preload bridge), so there's no
  // Node `require` at runtime. 'electron-renderer' assumes Node built-ins are available and
  // leaves some dependencies' `require('node:...')` calls unbundled, which then throw
  // "require is not defined" — 'web' makes webpack actually resolve/bundle them instead.
  target: 'web',
  output: {
    filename: 'renderer.js',
    path: path.resolve(__dirname, 'dist'),
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react'],
          },
        },
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.js', '.jsx'],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
    }),
  ],
};
