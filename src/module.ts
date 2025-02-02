import { readFileSync } from 'fs'
import {
  addServerHandler,
  createResolver,
  defineNuxtModule,
  resolveModule,
  addImportsDir,
  addTemplate
} from '@nuxt/kit'
import { join } from 'pathe'
import type { ComponentsDir } from '@nuxt/schema'
import { withoutLeadingSlash } from 'ufo'
import { metaPlugin } from './unplugin'
import { ModuleOptions } from './options'
import { ComponentMetaParser, useComponentMetaParser } from './parser'

export * from './options'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-component-meta',
    configKey: 'componentMeta'
  },
  defaults: nuxt => ({
    outputDir: nuxt.options.buildDir,
    rootDir: nuxt.options.rootDir,
    componentDirs: [],
    components: [],
    silent: true,
    exclude: ['nuxt/dist/app/components/client-only', 'nuxt/dist/app/components/dev-only'],
    metaFields: {
      props: true,
      slots: true,
      events: true,
      exposed: true
    },
    transformers: [
      // @nuxt/content support
      (component, code) => {
        code = code.replace(
          /<ContentSlot(.*)?:use="\$slots\.([a-z]+)"(.*)\/>/gm,
          (_, _before, slotName, _rest) => {
            return `<slot ${slotName === 'default' ? '' : `name="${slotName}"`} />`
          }
        )

        return { component, code }
      }
    ],
    checkerOptions: {
      forceUseTs: true,
      schema: {
        ignore: [
          'NuxtComponentMetaNames', // avoid loop
          'RouteLocationRaw', // vue router
          'RouteLocationPathRaw', // vue router
          'RouteLocationNamedRaw', // vue router
          'ComputedStyleProp', // Pinceau
          'VariantProp' // Pinceau
        ]
      }
    },
    globalsOnly: false
  }),
  async setup (options, nuxt) {
    const resolver = createResolver(import.meta.url)

    let parser: ComponentMetaParser

    // Retrieve transformers
    let transformers = options?.transformers || []
    transformers = await nuxt.callHook('component-meta:transformers' as any, transformers)

    // Resolve loaded components
    let componentDirs: (string | ComponentsDir)[] = [...(options?.componentDirs || [])]
    let components: any[] = []
    nuxt.hook('components:dirs', (dirs) => {
      componentDirs = [
        ...componentDirs,
        ...dirs,
        { path: resolveModule('nuxt').replace('/index.mjs', '/app') },
        { path: resolveModule('@nuxt/ui-templates').replace('/index.mjs', '/templates') }
      ]
      options.componentDirs = componentDirs
    })
    nuxt.hook('components:extend', async (_components) => {
      components = _components

      // Support `globalsOnly` option
      if (options?.globalsOnly) { components = components.filter(c => c.global) }

      options.components = components

      // Create parser once all necessary contexts has been resolved
      parser = useComponentMetaParser(options)

      // Stub output in case it does not exist yet
      await parser.stubOutput()
    })

    // Add useComponentMeta
    addImportsDir(resolver.resolve('./runtime/composables'))

    addTemplate({
      filename: 'component-meta.mjs',
      getContents: () => 'export default {}',
      write: true
    })

    addTemplate({
      filename: 'component-meta.d.ts',
      getContents: () => [
        "import type { NuxtComponentMeta } from 'nuxt-component-meta'",
        'export type { NuxtComponentMeta }',
        `export type NuxtComponentMetaNames = ${components.map((c: { pascalName: any }) => `'${c.pascalName}'`).join(' | ')}`,
        'declare const components: Record<NuxtComponentMetaNames, NuxtComponentMeta>',
        'export { components as default,  components }'
      ].join('\n'),
      write: true
    })

    // Vite plugin
    nuxt.hook('vite:extend', (vite: any) => {
      vite.config.plugins = vite.config.plugins || []
      vite.config.plugins.push(metaPlugin.vite({ ...options, parser }))
    })

    // Inject output alias
    nuxt.options.alias = nuxt.options.alias || {}
    nuxt.options.alias['#nuxt-component-meta'] = join(nuxt.options.buildDir, 'component-meta.mjs')
    nuxt.options.alias['#nuxt-component-meta/types'] = join(nuxt.options.buildDir, 'component-meta.d.ts')

    nuxt.hook('prepare:types', ({ tsConfig, references }) => {
      references.push({
        path: join(nuxt.options.buildDir, 'component-meta.d.ts')
      })
      tsConfig.compilerOptions = tsConfig.compilerOptions || {}
      tsConfig.compilerOptions.paths = tsConfig.compilerOptions.paths || {}
      tsConfig.compilerOptions.paths['#nuxt-component-meta'] = [withoutLeadingSlash(join(nuxt.options.buildDir, '/component-meta.mjs').replace(nuxt.options.rootDir, ''))]
      tsConfig.compilerOptions.paths['#nuxt-component-meta/types'] = [withoutLeadingSlash(join(nuxt.options.buildDir, '/component-meta.d.ts').replace(nuxt.options.rootDir, ''))]
    })

    // Nitro setup
    nuxt.hook('nitro:config', (nitroConfig) => {
      nitroConfig.handlers = nitroConfig.handlers || []
      nitroConfig.virtual = nitroConfig.virtual || {}
      nitroConfig.virtual['#nuxt-component-meta/nitro'] = () => readFileSync(join(nuxt.options.buildDir, '/component-meta.mjs'), 'utf-8')
    })
    addServerHandler({
      method: 'get',
      route: '/api/component-meta',
      handler: resolver.resolve('./runtime/server/api/component-meta.get')
    })
    addServerHandler({
      method: 'get',
      route: '/api/component-meta.json',
      handler: resolver.resolve('./runtime/server/api/component-meta.get')
    })
    addServerHandler({
      method: 'get',
      route: '/api/component-meta/:component?',
      handler: resolver.resolve('./runtime/server/api/component-meta.get')
    })
  }
})
