import { test, expect } from "@playwright/test"
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"

const runtime = join(process.cwd(), ".e2e-runtime")
const project = join(runtime, "project")

test.beforeAll(() => {
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, "sample.txt"), "Pi UI browser preview fixture\n")
})

test.afterAll(() => rmSync(runtime, { recursive: true, force: true }))

test("open a local project, create a folder, preview and search a file, then archive and restore", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "+ 打开项目目录" }).click()
  const dialog = page.getByRole("dialog", { name: "选择项目目录" })
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "磁盘根目录" }).click()
  for (const segment of realpathSync(project).split(sep).filter(Boolean)) {
    await dialog.getByRole("button", { name: `▸ ${segment}`, exact: true }).click()
  }
  await dialog.getByRole("button", { name: "＋ 新建文件夹" }).click()
  await dialog.getByRole("textbox", { name: "新文件夹名称" }).fill("created-in-browser")
  await dialog.getByRole("button", { name: "创建", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "↑ 上一级" })).toBeVisible()
  await dialog.getByRole("button", { name: "↑ 上一级" }).click()
  await dialog.getByRole("button", { name: "选择此目录" }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole("button", { name: "Files" }).click()
  await page.getByRole("button", { name: /sample\.txt/ }).click()
  await expect(page.getByText("Pi UI browser preview fixture")).toBeVisible()
  await page.getByRole("textbox", { name: "搜索项目文件" }).fill("sample")
  await expect(page.getByRole("button", { name: /sample\.txt/ })).toBeVisible()

  await page.getByRole("button", { name: "归档项目 project" }).click()
  await page.getByText(/已归档项目/).click()
  await page.getByRole("button", { name: "恢复项目 project" }).click()
  await expect(page.getByRole("button", { name: "归档项目 project" })).toBeVisible()
})

test("save, edit and remove a project memory in the browser", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "+ 打开项目目录" }).click()
  const dialog = page.getByRole("dialog", { name: "选择项目目录" })
  await dialog.getByRole("button", { name: "磁盘根目录" }).click()
  for (const segment of realpathSync(project).split(sep).filter(Boolean)) {
    await dialog.getByRole("button", { name: `▸ ${segment}`, exact: true }).click()
  }
  await dialog.getByRole("button", { name: "选择此目录" }).click()
  await page.getByRole("button", { name: "Memory" }).click()
  const recall = page.getByLabel("自动调用已确认的记忆")
  await expect(recall).toBeChecked()
  await recall.uncheck()
  await expect(recall).not.toBeChecked()
  await recall.check()
  const editor = page.getByPlaceholder("写下希望长期记住的事实或偏好")
  await editor.fill("测试偏好：回答简洁")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.getByText("已保存 · 1 条")).toBeVisible()
  await page.getByRole("button", { name: "编辑" }).click()
  await editor.fill("测试偏好：先给结论")
  await page.getByRole("button", { name: "保存", exact: true }).click()
  await expect(page.getByText("测试偏好：先给结论", { exact: true })).toBeVisible()
  page.once("dialog", d => d.accept())
  await page.getByRole("button", { name: "删除" }).click()
  await expect(page.getByText("已保存 · 0 条")).toBeVisible()
})
