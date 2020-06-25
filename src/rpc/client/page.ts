/**
 * Copyright 2017 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { EventEmitter } from 'events';
import { Events } from '../../events';
import { assert, assertMaxArguments, helper, Listener } from '../../helper';
import * as types from '../../types';
import { BrowserContextChannel, FrameChannel, PageChannel } from '../channels';
import { BrowserContext } from './browserContext';
import { ChannelOwner } from './channelOwner';
import { ElementHandle } from './elementHandle';
import { Frame, FunctionWithSource, GotoOptions } from './frame';
import { Func1, FuncOn, SmartHandle } from './jsHandle';
import { Request, Response, RouteHandler } from './network';
import { Connection } from '../connection';

export class Page extends ChannelOwner<PageChannel> {
  readonly pdf: ((options?: types.PDFOptions) => Promise<Buffer>) | undefined;

  private _browserContext: BrowserContext | undefined;
  private _mainFrame: Frame | undefined;
  private _frames = new Set<Frame>();
  private _workers: Worker[] = [];
  private _closed = false;
  private _viewportSize: types.Size | null = null;
  private _routes: { url: types.URLMatch, handler: RouteHandler }[] = [];

  static from(page: PageChannel): Page {
    return page._object;
  }

  static fromNullable(page: PageChannel | null): Page | null {
    return page ? Page.from(page) : null;
  }

  constructor(connection: Connection, channel: PageChannel) {
    super(connection, channel);
  }

  _initialize(payload: { browserContext: BrowserContextChannel, mainFrame: FrameChannel, viewportSize: types.Size }) {
    this._browserContext = BrowserContext.from(payload.browserContext);
    this._mainFrame = Frame.from(payload.mainFrame);
    this._frames.add(this._mainFrame);
    this._viewportSize = payload.viewportSize;

    this._channel.on('frameAttached', frame => this._onFrameAttached(Frame.from(frame)));
    this._channel.on('frameDetached', frame => this._onFrameDetached(Frame.from(frame)));
    this._channel.on('frameNavigated', ({ frame, url }) => this._onFrameNavigated(Frame.from(frame), url));
    this._channel.on('request', request => this.emit(Events.Page.Request, Request.from(request)));
    this._channel.on('response', response => this.emit(Events.Page.Response, Response.from(response)));
    this._channel.on('requestFinished', request => this.emit(Events.Page.Request, Request.from(request)));
    this._channel.on('requestFailed', request => this.emit(Events.Page.Request, Request.from(request)));
    this._channel.on('close', () => this._onClose());
  }

  private _onFrameAttached(frame: Frame) {
    this._frames.add(frame);
    if (frame._parentFrame)
      frame._parentFrame._childFrames.add(frame);
    this.emit(Events.Page.FrameAttached, frame);
  }

  private _onFrameDetached(frame: Frame) {
    this._frames.delete(frame);
    if (frame._parentFrame)
      frame._parentFrame._childFrames.delete(frame);
    this.emit(Events.Page.FrameDetached, frame);
  }

  private _onFrameNavigated(frame: Frame, url: string) {
    frame._url = url;
    this.emit(Events.Page.FrameNavigated, frame);
  }

  private _onClose() {
    this._browserContext!._pages.delete(this);
    this.emit(Events.Page.Close);
  }

  context(): BrowserContext {
    return this._browserContext!;
  }

  async opener(): Promise<Page | null> {
    return Page.fromNullable(await this._channel.opener());
  }

  mainFrame(): Frame {
    return this._mainFrame!!;
  }

  frame(options: string | { name?: string, url?: types.URLMatch }): Frame | null {
    const name = helper.isString(options) ? options : options.name;
    const url = helper.isObject(options) ? options.url : undefined;
    assert(name || url, 'Either name or url matcher should be specified');
    return this.frames().find(f => {
      if (name)
        return f.name() === name;
      return helper.urlMatches(f.url(), url);
    }) || null;
  }

  frames(): Frame[] {
    return [...this._frames];
  }

  setDefaultNavigationTimeout(timeout: number) {
    this._channel.setDefaultNavigationTimeoutNoReply({ timeout });
  }

  setDefaultTimeout(timeout: number) {
    this._channel.setDefaultTimeoutNoReply({ timeout });
  }

  async $(selector: string): Promise<ElementHandle<Element> | null> {
    return await this._mainFrame!.$(selector);
  }

  async waitForSelector(selector: string, options?: types.WaitForElementOptions): Promise<ElementHandle<Element> | null> {
    return await this._mainFrame!.waitForSelector(selector, options);
  }

  async dispatchEvent(selector: string, type: string, eventInit?: Object, options?: types.TimeoutOptions): Promise<void> {
    return await this._mainFrame!.dispatchEvent(selector, type, eventInit, options);
  }

  async evaluateHandle<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<SmartHandle<R>>;
  async evaluateHandle<R>(pageFunction: Func1<void, R>, arg?: any): Promise<SmartHandle<R>>;
  async evaluateHandle<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<SmartHandle<R>> {
    assertMaxArguments(arguments.length, 2);
    return await this._mainFrame!.evaluateHandle(pageFunction, arg);
  }

  async $eval<R, Arg>(selector: string, pageFunction: FuncOn<Element, Arg, R>, arg: Arg): Promise<R>;
  async $eval<R>(selector: string, pageFunction: FuncOn<Element, void, R>, arg?: any): Promise<R>;
  async $eval<R, Arg>(selector: string, pageFunction: FuncOn<Element, Arg, R>, arg: Arg): Promise<R> {
    assertMaxArguments(arguments.length, 3);
    return await this._mainFrame!.$eval(selector, pageFunction, arg);
  }

  async $$eval<R, Arg>(selector: string, pageFunction: FuncOn<Element[], Arg, R>, arg: Arg): Promise<R>;
  async $$eval<R>(selector: string, pageFunction: FuncOn<Element[], void, R>, arg?: any): Promise<R>;
  async $$eval<R, Arg>(selector: string, pageFunction: FuncOn<Element[], Arg, R>, arg: Arg): Promise<R> {
    assertMaxArguments(arguments.length, 3);
    return await this._mainFrame!.$$eval(selector, pageFunction, arg);
  }

  async $$(selector: string): Promise<ElementHandle<Element>[]> {
    return await this._mainFrame!.$$(selector);
  }

  async addScriptTag(options: { url?: string; path?: string; content?: string; type?: string; }): Promise<ElementHandle> {
    return await this._mainFrame!.addScriptTag(options);
  }

  async addStyleTag(options: { url?: string; path?: string; content?: string; }): Promise<ElementHandle> {
    return  await this._mainFrame!.addStyleTag(options);
  }

  async exposeFunction(name: string, playwrightFunction: Function) {
    await this.exposeBinding(name, (options, ...args: any) => playwrightFunction(...args));
  }

  async exposeBinding(name: string, playwrightBinding: FunctionWithSource) {
    await this._channel.exposeBinding({ name });
  }

  async setExtraHTTPHeaders(headers: types.Headers) {
    await this._channel.setExtraHTTPHeaders({ headers });
  }

  url(): string {
    return this.mainFrame().url();
  }

  async content(): Promise<string> {
    return this.mainFrame().content();
  }

  async setContent(html: string, options?: types.NavigateOptions): Promise<void> {
    return this.mainFrame().setContent(html, options);
  }

  async goto(url: string, options?: GotoOptions): Promise<Response | null> {
    return this.mainFrame().goto(url, options);
  }

  async reload(options?: types.NavigateOptions): Promise<Response | null> {
    return Response.fromNullable(await this._channel.reload({ options }));
  }

  async waitForLoadState(state?: types.LifecycleEvent, options?: types.TimeoutOptions): Promise<void> {
    return this._mainFrame!.waitForLoadState(state, options);
  }

  async waitForNavigation(options?: types.WaitForNavigationOptions): Promise<Response | null> {
    return this._mainFrame!.waitForNavigation(options);
  }

  async waitForRequest(urlOrPredicate: string | RegExp | ((r: Request) => boolean), options: types.TimeoutOptions = {}): Promise<Request> {
    const predicate = (request: Request) => {
      if (helper.isString(urlOrPredicate) || helper.isRegExp(urlOrPredicate))
        return helper.urlMatches(request.url(), urlOrPredicate);
      return urlOrPredicate(request);
    };
    return this.waitForEvent(Events.Page.Request, { predicate, timeout: options.timeout });
  }

  async waitForResponse(urlOrPredicate: string | RegExp | ((r: Response) => boolean), options: types.TimeoutOptions = {}): Promise<Response> {
    const predicate = (response: Response) => {
      if (helper.isString(urlOrPredicate) || helper.isRegExp(urlOrPredicate))
        return helper.urlMatches(response.url(), urlOrPredicate);
      return urlOrPredicate(response);
    };
    return this.waitForEvent(Events.Page.Response, { predicate, timeout: options.timeout });
  }

  async waitForEvent(event: string, optionsOrPredicate: types.WaitForEventOptions = {}): Promise<any> {
    return await this._channel.waitForEvent({ event });
  }

  async goBack(options?: types.NavigateOptions): Promise<Response | null> {
    return Response.fromNullable(await this._channel.goBack({ options }));
  }

  async goForward(options?: types.NavigateOptions): Promise<Response | null> {
    return Response.fromNullable(await this._channel.goForward({ options }));
  }

  async emulateMedia(options: { media?: types.MediaType, colorScheme?: types.ColorScheme }) {
    await this._channel.emulateMedia({ options });
  }

  async setViewportSize(viewportSize: types.Size) {
    await this._channel.setViewportSize({ viewportSize });
  }

  viewportSize(): types.Size | null {
    return this._viewportSize;
  }

  async evaluate<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<R>;
  async evaluate<R>(pageFunction: Func1<void, R>, arg?: any): Promise<R>;
  async evaluate<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<R> {
    assertMaxArguments(arguments.length, 2);
    return this.mainFrame().evaluate(pageFunction, arg);
  }

  async addInitScript(script: Function | string | { path?: string, content?: string }, arg?: any) {
    const source = await helper.evaluationScript(script, arg);
    await this._channel.addInitScript({ source });
  }

  async route(url: types.URLMatch, handler: RouteHandler): Promise<void> {
    this._routes.push({ url, handler });
    if (this._routes.length === 1)
      await this._channel.setNetworkInterceptionEnabled({ enabled: true });
  }

  async unroute(url: types.URLMatch, handler?: RouteHandler): Promise<void> {
    this._routes = this._routes.filter(route => route.url !== url || (handler && route.handler !== handler));
    if (this._routes.length === 0)
      await this._channel.setNetworkInterceptionEnabled({ enabled: false });
  }

  async screenshot(options?: types.ScreenshotOptions): Promise<Buffer> {
    return await this._channel.screenshot({ options });
  }

  async title(): Promise<string> {
    return this.mainFrame().title();
  }

  async close(options: { runBeforeUnload?: boolean } = {runBeforeUnload: undefined}) {
    await this._channel.close({ options });
  }

  isClosed(): boolean {
    return this._closed;
  }

  async click(selector: string, options?: types.MouseClickOptions & types.PointerActionWaitOptions & types.NavigatingActionWaitOptions) {
    return this.mainFrame().click(selector, options);
  }

  async dblclick(selector: string, options?: types.MouseMultiClickOptions & types.PointerActionWaitOptions & types.NavigatingActionWaitOptions) {
    return this.mainFrame().dblclick(selector, options);
  }

  async fill(selector: string, value: string, options?: types.NavigatingActionWaitOptions) {
    return this.mainFrame().fill(selector, value, options);
  }

  async focus(selector: string, options?: types.TimeoutOptions) {
    return this.mainFrame().focus(selector, options);
  }

  async textContent(selector: string, options?: types.TimeoutOptions): Promise<null|string> {
    return this.mainFrame().textContent(selector, options);
  }

  async innerText(selector: string, options?: types.TimeoutOptions): Promise<string> {
    return this.mainFrame().innerText(selector, options);
  }

  async innerHTML(selector: string, options?: types.TimeoutOptions): Promise<string> {
    return this.mainFrame().innerHTML(selector, options);
  }

  async getAttribute(selector: string, name: string, options?: types.TimeoutOptions): Promise<string | null> {
    return this.mainFrame().getAttribute(selector, name, options);
  }

  async hover(selector: string, options?: types.PointerActionOptions & types.PointerActionWaitOptions) {
    return this.mainFrame().hover(selector, options);
  }

  async selectOption(selector: string, values: string | ElementHandle | types.SelectOption | string[] | ElementHandle[] | types.SelectOption[] | null, options?: types.NavigatingActionWaitOptions): Promise<string[]> {
    return this.mainFrame().selectOption(selector, values, options);
  }

  async setInputFiles(selector: string, files: string | types.FilePayload | string[] | types.FilePayload[], options?: types.NavigatingActionWaitOptions): Promise<void> {
    return this.mainFrame().setInputFiles(selector, files, options);
  }

  async type(selector: string, text: string, options?: { delay?: number } & types.NavigatingActionWaitOptions) {
    return this.mainFrame().type(selector, text, options);
  }

  async press(selector: string, key: string, options?: { delay?: number } & types.NavigatingActionWaitOptions) {
    return this.mainFrame().press(selector, key, options);
  }

  async check(selector: string, options?: types.PointerActionWaitOptions & types.NavigatingActionWaitOptions) {
    return this.mainFrame().check(selector, options);
  }

  async uncheck(selector: string, options?: types.PointerActionWaitOptions & types.NavigatingActionWaitOptions) {
    return this.mainFrame().uncheck(selector, options);
  }

  async waitForTimeout(timeout: number) {
    await this.mainFrame().waitForTimeout(timeout);
  }

  async waitForFunction<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg, options?: types.WaitForFunctionOptions): Promise<SmartHandle<R>>;
  async waitForFunction<R>(pageFunction: Func1<void, R>, arg?: any, options?: types.WaitForFunctionOptions): Promise<SmartHandle<R>>;
  async waitForFunction<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg, options?: types.WaitForFunctionOptions): Promise<SmartHandle<R>> {
    return this.mainFrame().waitForFunction(pageFunction, arg, options);
  }

  workers(): Worker[] {
    return this._workers;
  }

  on(event: string | symbol, listener: Listener): this {
    if (event === Events.Page.FileChooser) {
      if (!this.listenerCount(event))
        this._channel.setFileChooserInterceptedNoReply({ intercepted: true });
    }
    super.on(event, listener);
    return this;
  }

  removeListener(event: string | symbol, listener: Listener): this {
    super.removeListener(event, listener);
    if (event === Events.Page.FileChooser && !this.listenerCount(event))
      this._channel.setFileChooserInterceptedNoReply({ intercepted: false });
    return this;
  }
}

export class Worker extends EventEmitter {
  private _url: string;
  private _channel: any;

  constructor(url: string) {
    super();
    this._url = url;
  }

  url(): string {
    return this._url;
  }

  async evaluate<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<R>;
  async evaluate<R>(pageFunction: Func1<void, R>, arg?: any): Promise<R>;
  async evaluate<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<R> {
    assertMaxArguments(arguments.length, 2);
    return await this._channel.evaluate({ pageFunction, arg });
  }

  async evaluateHandle<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<SmartHandle<R>>;
  async evaluateHandle<R>(pageFunction: Func1<void, R>, arg?: any): Promise<SmartHandle<R>>;
  async evaluateHandle<R, Arg>(pageFunction: Func1<Arg, R>, arg: Arg): Promise<SmartHandle<R>> {
    assertMaxArguments(arguments.length, 2);
    return await this._channel.evaluateHandle({ pageFunction, arg });
  }
}
