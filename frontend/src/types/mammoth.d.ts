declare module "mammoth" {
  interface MammothResult {
    value: string
    messages: unknown[]
  }

  interface MammothApi {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
  }

  const mammoth: MammothApi
  export default mammoth
}
