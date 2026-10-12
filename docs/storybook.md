# Тема Storybook внутри Blueprint

Blueprint передаёт выбранную тему во встроенный Storybook через `postMessage`, проверяя origin и окно отправителя. Адаптер использует публичный канал Storybook для синхронизации интерфейса, Docs и canvas. Переключение сохраняет выбранную историю и Controls, поскольку iframe остаётся загруженным.

После `blueprint update` файлы `blueprint/storybook-theme.js` и `.d.ts` доступны в проекте. Укажи относительный путь к ним из своей папки `.storybook`; в примерах она находится в корне проекта. Blueprint не устанавливает пакеты Storybook.

## Интерфейс каталога

В `.storybook/manager.ts`:

```ts
import { addons } from "storybook/manager-api";
import { themes } from "storybook/theming";
import { connectStorybookManager } from "../blueprint/storybook-theme.js";

addons.register("blueprint/theme", () => {
  connectStorybookManager(addons.getChannel(), (theme) => {
    addons.setConfig({ theme: themes[theme] });
  });
});
```

Подключение внутри `addons.register` получает канал после инициализации manager. На уровне модуля `addons.getChannel()` может вернуть временный канал без связи с preview.

## Docs и компоненты в React

В `.storybook/preview.tsx` добавь контейнер Docs, сохранив остальные параметры и декораторы проекта:

```tsx
import { DocsContainer, type DocsContainerProps } from "@storybook/addon-docs/blocks";
import { useSyncExternalStore } from "react";
import { addons } from "storybook/preview-api";
import { themes } from "storybook/theming";
import { connectStorybookPreview } from "../blueprint/storybook-theme.js";

const store = connectStorybookPreview(addons.getChannel());

function ThemedDocs(props: DocsContainerProps) {
  const theme = useSyncExternalStore(store.subscribe, store.getTheme);
  return <DocsContainer {...props} theme={themes[theme]} />;
}

export default {
  parameters: { docs: { container: ThemedDocs } },
};
```

Адаптер выставляет `data-theme="light"` или `"dark"` на корневом элементе preview. Подключи к нему обе палитры компонентов через CSS или существующий провайдер темы проекта. Сам адаптер не меняет продуктовые цвета.

При поддержке HMR в preview вызови `store.dispose` из обработчика `import.meta.hot.dispose`, чтобы обновления конфигурации не дублировали подписки. Конфигурация manager собирается отдельно; после её изменения перезапусти Storybook.

Без Blueprint начальная тема берётся из `prefers-color-scheme`. Сторонний каталог без этого адаптера продолжает управлять своей темой самостоятельно. Подключение использует API [Storybook 10](https://storybook.js.org/docs/configure/user-interface/theming).
