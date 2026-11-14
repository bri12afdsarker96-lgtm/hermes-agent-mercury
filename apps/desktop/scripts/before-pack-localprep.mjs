import beforePack from './before-pack.mjs'

export default function beforeLocalPack(context) {
  return beforePack(context, { localVerification: true })
}
