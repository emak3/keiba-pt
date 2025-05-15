/**
 * 安全なセレクトメニューオプションを作成するヘルパー関数
 * @param {Object[]} items オプションにしたいアイテムの配列
 * @param {Function} labelFn ラベルを生成する関数
 * @param {Function} valueFn 値を生成する関数
 * @param {Function} descriptionFn 説明を生成する関数（オプション）
 * @returns {Object[]} バリデーション済みのオプション配列
 */
function createSafeSelectOptions(items, labelFn, valueFn, descriptionFn = null) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return [{
      label: '選択可能な項目がありません',
      value: 'no_options_available'
    }];
  }

  const options = items
    .filter(item => item !== null && item !== undefined) // nullやundefinedをフィルタリング
    .map(item => {
      const label = labelFn(item);
      const value = valueFn(item);
      
      // labelとvalueが両方とも有効かチェック
      if (!label || !value) {
        return null;
      }
      
      const option = {
        label: String(label).substring(0, 100), // Discordの制限（100文字）に合わせる
        value: String(value).substring(0, 100)  // Discordの制限（100文字）に合わせる
      };
      
      if (descriptionFn) {
        const description = descriptionFn(item);
        if (description) {
          option.description = String(description).substring(0, 100); // Discordの制限
        }
      }
      
      return option;
    })
    .filter(option => option !== null); // 無効なオプションを除外
  
  // オプションが空の場合はデフォルトオプションを追加
  if (options.length === 0) {
    options.push({
      label: '選択可能な項目がありません',
      value: 'no_options_available'
    });
  }
  
  return options;
}

/**
 * StringSelectMenuBuilderインスタンスに安全にオプションを追加する
 * @param {StringSelectMenuBuilder} selectMenu セレクトメニュービルダー
 * @param {Object[]} options 追加するオプション配列
 * @returns {StringSelectMenuBuilder} 更新されたセレクトメニュービルダー
 */
function addSafeOptions(selectMenu, options) {
  // オプションが空か無効な場合はデフォルトオプションを追加
  if (!options || !Array.isArray(options) || options.length === 0) {
    return selectMenu.addOptions({
      label: '選択可能な項目がありません',
      value: 'no_options_available'
    });
  }
  
  // 最大25個のオプションまで（Discordの制限）
  const validOptions = options.slice(0, 25);
  
  return selectMenu.addOptions(validOptions);
}

module.exports = {
  createSafeSelectOptions,
  addSafeOptions
};