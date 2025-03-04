/**
 * Copyright 2018 Google Inc. All rights reserved.
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

import pixelmatch from '../../packages/playwright-core/src/third_party/pixelmatch';
import { PNG } from 'playwright-core/lib/utilsBundle';
import { expect, playwrightTest as it } from '../config/browserTest';

it('should have default url when launching browser @smoke', async ({ browserType, createUserDataDir }) => {
  const browserContext = await browserType.launchPersistentContext(await createUserDataDir(), { headless: false });
  const urls = browserContext.pages().map(page => page.url());
  expect(urls).toEqual(['about:blank']);
  await browserContext.close();
});

it('should close browser with beforeunload page', async ({ browserType, server, createUserDataDir }) => {
  it.slow();

  const browserContext = await browserType.launchPersistentContext(await createUserDataDir(), { headless: false });
  const page = await browserContext.newPage();
  await page.goto(server.PREFIX + '/beforeunload.html');
  // We have to interact with a page so that 'beforeunload' handlers
  // fire.
  await page.click('body');
  await browserContext.close();
});

it('should close browsercontext with pending beforeunload dialog', async ({ server, browserType }) => {
  const browser = await browserType.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(server.PREFIX + '/beforeunload.html');
  // We have to interact with a page so that 'beforeunload' handlers
  // fire.
  await page.click('body');
  await Promise.all([
    page.waitForEvent('dialog'),
    page.close({ runBeforeUnload: true }),
  ]);
  await context.close();
  await browser.close();
});


it('should not crash when creating second context', async ({ browserType }) => {
  const browser = await browserType.launch({ headless: false });
  {
    const browserContext = await browser.newContext();
    await browserContext.newPage();
    await browserContext.close();
  }
  {
    const browserContext = await browser.newContext();
    await browserContext.newPage();
    await browserContext.close();
  }
  await browser.close();
});

it('should click background tab', async ({ browserType, server }) => {
  const browser = await browserType.launch({ headless: false });
  const page = await browser.newPage();
  await page.setContent(`<button>Hello</button><a target=_blank href="${server.EMPTY_PAGE}">empty.html</a>`);
  await page.click('a');
  await page.click('button');
  await browser.close();
});

it('should close browser after context menu was triggered', async ({ browserType, server }) => {
  const browser = await browserType.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(server.PREFIX + '/grid.html');
  await page.click('body', { button: 'right' });
  await browser.close();
});

it('should(not) block third party cookies', async ({ browserType, server, browserName, browserMajorVersion }) => {
  const browser = await browserType.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(server.EMPTY_PAGE);
  await page.evaluate(src => {
    let fulfill;
    const promise = new Promise(x => fulfill = x);
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    iframe.onload = fulfill;
    iframe.src = src;
    return promise;
  }, server.CROSS_PROCESS_PREFIX + '/grid.html');
  const documentCookie = await page.frames()[1].evaluate(() => {
    document.cookie = 'username=John Doe';
    return document.cookie;
  });
  await page.waitForTimeout(2000);
  const allowsThirdParty = browserName === 'firefox' && (browserMajorVersion >= 97 && browserMajorVersion < 103);
  expect(documentCookie).toBe(allowsThirdParty ? 'username=John Doe' : '');
  const cookies = await page.context().cookies(server.CROSS_PROCESS_PREFIX + '/grid.html');
  if (allowsThirdParty) {
    expect(cookies).toEqual([
      {
        'domain': '127.0.0.1',
        'expires': -1,
        'httpOnly': false,
        'name': 'username',
        'path': '/',
        'sameSite': 'None',
        'secure': false,
        'value': 'John Doe'
      }
    ]);
  } else {
    expect(cookies).toEqual([]);
  }
  await browser.close();
});

it('should not block third party SameSite=None cookies', async ({ httpsServer, browserName, browserType }) => {
  it.skip(browserName === 'webkit', 'No third party cookies in WebKit');
  const browser = await browserType.launch({ headless: false });
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
  });

  httpsServer.setRoute('/empty.html', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html'
    });
    res.end(`<iframe src="${httpsServer.CROSS_PROCESS_PREFIX}/grid.html"></iframe>`);
  });

  httpsServer.setRoute('/grid.html', (req, res) => {
    res.writeHead(200, {
      'Set-Cookie': ['a=b; Path=/; Max-Age=3600; SameSite=None; Secure'],
      'Content-Type': 'text/html'
    });
    res.end(`Hello world
    <script>
    setTimeout(() => fetch('/json'), 1000);
    </script>`);
  });

  const cookie = new Promise(f => {
    httpsServer.setRoute('/json', (req, res) => {
      f(req.headers.cookie);
      res.end();
    });
  });

  await page.goto(httpsServer.EMPTY_PAGE);
  expect(await cookie).toBe('a=b');
  await browser.close();
});

it('should not override viewport size when passed null', async function({ browserType, server, browserName }) {
  it.fixme(browserName === 'webkit');

  // Our WebKit embedder does not respect window features.
  const browser = await browserType.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.goto(server.EMPTY_PAGE);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(() => {
      const win = window.open(window.location.href, 'Title', 'toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=600,height=300,top=0,left=0');
      win.resizeTo(500, 450);
    }),
  ]);
  await popup.waitForLoadState();
  await popup.waitForFunction(() => window.outerWidth === 500 && window.outerHeight === 450);
  await context.close();
  await browser.close();
});

it('Page.bringToFront should work', async ({ browserType }) => {
  const browser = await browserType.launch({ headless: false });
  const page1 = await browser.newPage();
  await page1.setContent('Page1');
  const page2 = await browser.newPage();
  await page2.setContent('Page2');

  await page1.bringToFront();
  expect(await page1.evaluate('document.visibilityState')).toBe('visible');
  expect(await page2.evaluate('document.visibilityState')).toBe('visible');

  await page2.bringToFront();
  expect(await page1.evaluate('document.visibilityState')).toBe('visible');
  expect(await page2.evaluate('document.visibilityState')).toBe(
      'visible'
  );
  await browser.close();
});

it.skip('should click in OOPIF', async ({ browserName, browserType, createUserDataDir, server }) => {
  it.fixme(browserName === 'chromium');
  server.setRoute('/empty.html', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<iframe src="${server.CROSS_PROCESS_PREFIX}/iframe.html"></iframe>`);
  });
  server.setRoute('/iframe.html', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<button id="button" onclick="console.log('ok')">Submit</button>
    <script>console.log('frame loaded')</script>`);
  });

  const context = await browserType.launchPersistentContext(await createUserDataDir(), { headless: false });
  const [page] = context.pages();
  const consoleLog: string[] = [];
  page.on('console', m => consoleLog.push(m.text()));
  await page.goto(server.EMPTY_PAGE);
  await page.frames()[1].click('text=Submit');
  expect(consoleLog).toContain('ok');
});

it.skip('should click bottom row w/ infobar in OOPIF', async ({ browserType, createUserDataDir, server }) => {
  server.setRoute('/empty.html', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
        iframe { position: absolute; bottom: 0; }
      </style>
      <iframe src="${server.CROSS_PROCESS_PREFIX}/iframe.html"></iframe>
    `);
  });

  server.setRoute('/iframe.html', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; }
        button { position: absolute; bottom: 0; }
      </style>
      <button id="button" onclick="console.log('ok')">Submit</button>`);
  });

  const browserContext = await browserType.launchPersistentContext(await createUserDataDir(), { headless: false });
  const [page] = browserContext.pages();
  await page.goto(server.EMPTY_PAGE);
  // Chrome bug! Investigate what's happening in the oopif router.
  const consoleLog: string[] = [];
  page.on('console', m => consoleLog.push(m.text()));
  while (!consoleLog.includes('ok')) {
    await page.waitForTimeout(100);
    await page.frames()[1].click('text=Submit');
  }
});

it('headless and headful should use same default fonts', async ({ page, headless, browserName, browserType, platform }) => {
  it.info().annotations.push({ type: 'issue', description: 'https://github.com/microsoft/playwright/issues/11177' });
  it.fixme(browserName === 'firefox', 'Text is misaligned in headed vs headless');
  const genericFontFamilies = [
    'standard',
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'emoji'
  ];
  const headedBrowser = await browserType.launch({ headless: !headless });
  const headedPage = await headedBrowser.newPage();
  for (const family of genericFontFamilies) {
    const content = `<div style="font: 15px bold ${family === 'standard' ? '' : family}; max-width: 300px; max-height: 300px; overflow: hidden">
      Lorem ipsum dolor sit amet consectetur adipiscing elit proin, integer curabitur imperdiet rhoncus cursus tincidunt bibendum, consequat sed magnis laoreet luctus mollis tellus. Nisl parturient mus accumsan feugiat sem laoreet magnis nisi, aptent per sollicitudin gravida orci ac blandit, viverra eros praesent auctor vivamus semper bibendum. Consequat sed habitasse luctus dictumst gravida platea semper phasellus, nascetur ridiculus purus est varius quisque et scelerisque, id vehicula eleifend montes sollicitudin dis velit. Pellentesque ridiculus per natoque et eleifend taciti nunc, laoreet auctor at condimentum imperdiet ante, conubia mi cubilia scelerisque sociosqu sem.</p> <p>Curabitur magna per felis primis mauris non dapibus luctus ultricies eros, quis et egestas condimentum lobortis eget semper montes litora purus, ridiculus elementum sollicitudin imperdiet dictum lacinia parturient cras eu. Risus cum varius rhoncus eros torquent pretium taciti id erat dis egestas, nibh tristique montes convallis metus lacus phasellus blandit ut auctor bibendum semper, facilisis mi integer eget ultrices lobortis odio viverra duis dui. Risus ullamcorper lacinia in venenatis sodales fusce tortor potenti volutpat quis, dictum vulputate suspendisse velit mollis torquent sociis aptent morbi, senectus nascetur justo maecenas conubia magnis viverra gravida fames. Phasellus sed nec gravida nibh class augue lectus, blandit quis turpis orci diam nam pellentesque, ultricies metus imperdiet hendrerit lacinia lacus.</p> <p>Inceptos facilisi montes cum hendrerit, pulvinar ut tellus eget velit, arcu nulla aenean. Phasellus augue urna nostra molestie interdum vehicula, posuere fames cum euismod massa curabitur donec, inceptos cubilia tellus facilisis fermentum. Lacus laoreet facilisis ultrices cursus quisque at ad porta vestibulum massa inceptos, curae class aliquet maecenas cum ullamcorper pulvinar erat mus vitae. Cum in aenean convallis dis quam tincidunt justo sed quisque, imperdiet faucibus hendrerit felis commodo scelerisque magnis vehicula etiam leo, eros varius platea lobortis maecenas condimentum nisi phasellus. Turpis vulputate mus himenaeos sociosqu facilisis dignissim leo quam, ultricies habitasse commodo molestie est tortor vitae et, porttitor risus erat cursus phasellus facilisi litora.</p> <p>Nostra habitasse egestas magnis velit pellentesque parturient cum lectus viverra, vestibulum sociosqu nunc vel urna consequat lacinia phasellus at sapien, aenean pretium dictum sed montes interdum imperdiet iaculis. Leo hac eros arcu senectus maecenas, tortor pulvinar venenatis lacinia volutpat, mattis platea ut facilisi. Aenean condimentum at et donec sociosqu fermentum luctus potenti semper vulputate, sapien justo non est auctor gravida ultricies fames per commodo, sed habitasse facilisi nulla quisque hendrerit aliquet viverra bibendum.</p> <p>Interdum nisl quam etiam montes porttitor laoreet nullam senectus velit, mauris proin tellus imperdiet litora venenatis fames massa quis, sollicitudin justo vivamus curae in sociis suscipit facilisi. Platea inceptos lacus elementum pellentesque quam euismod dictumst sociis tincidunt vulputate porttitor eros, turpis netus ut ad tempor sapien aliquet sodales molestie consequat nostra. Cum augue in quisque primis ut nunc sodales, sem orci tempus posuere cubilia suspendisse lacinia ligula, magna sed ridiculus at maecenas habitant.</p> <p>Natoque magna ac feugiat tellus bibendum diam, metus lobortis nisl ornare varius praesent, dictumst gravida lacus parturient semper. Pellentesque faucibus congue fusce posuere placerat dictum vitae, dui vestibulum eu sociis tempus aliquam ultricies malesuada, potenti laoreet lacus sem gravida nisi. Nostra platea sagittis hendrerit congue conubia senectus bibendum quis sapien pharetra, scelerisque nam imperdiet fermentum feugiat suspendisse viverra luctus at, semper ac consequat vitae mi gravida parturient mollis nascetur. Vel taciti justo consequat primis et blandit convallis sed, felis purus fusce a venenatis etiam aenean scelerisque, fringilla volutpat sagittis egestas rutrum id dis.</p> <p>Feugiat fermentum tortor ante ac iaculis sollicitudin ut interdum, cras orci ullamcorper potenti tristique vehicula. Molestie tortor ullamcorper rutrum turpis malesuada phasellus sem ultricies praesent mattis lobortis porta, senectus venenatis diam nostra laoreet volutpat per aptent justo elementum cum. Urna cursus vel felis cras eleifend arcu enim magnis, duis rutrum nibh nascetur cubilia interdum ultrices curae, id lacus aliquam dictumst diam fringilla lacinia.</p> <p>Luctus diam morbi eget tellus libero taciti faucibus inceptos, natoque facilisis lectus maecenas risus dapibus suscipit nibh, vel curae conubia orci imperdiet metus fusce. Condimentum massa donec luctus pharetra cum, in viverra placerat nisl litora facilisis, neque nascetur sociis dictumst. Suscipit accumsan eget rhoncus pharetra justo malesuada aliquet, suspendisse metus eleifend tincidunt varius ridiculus, convallis primis vitae curabitur quis mus.</p> <p>Gravida donec lacus molestie tortor aenean ultricies blandit per tempor, nostra penatibus orci vestibulum semper lectus vel a, montes potenti cum dapibus natoque eu volutpat nulla. Himenaeos purus nam malesuada habitasse nisl pharetra laoreet feugiat mi non, ultrices ultricies a cras ante eu venenatis ligula. Suscipit ut mus habitasse at aliquet sodales commodo justo, feugiat platea sagittis phasellus eleifend pellentesque interdum iaculis, integer cubilia montes metus hendrerit tincidunt purus.</p> <p>Vel posuere tellus dapibus eget duis cubilia, nec class vehicula libero gravida ligula, tempus urna taciti donec congue. Facilisis ridiculus congue cum dui per augue natoque, molestie hac etiam pellentesque dignissim urna class, feugiat aenean massa himenaeos penatibus ut eu, convallis purus et fusce tempus mattis. At mattis suscipit porta nostra nec facilisis sodales turpis, integer et lectus conubia justo nam congue taciti odio, fermentum semper cubilia fusce nunc purus velit.
      <div/>
    `;
    await Promise.all([page.setContent(content), headedPage.setContent(content)]);
    const [image1, image2] = (await Promise.all([
      page.screenshot(), headedPage.screenshot()
    ])).map(buffer => PNG.sync.read(buffer));
    const count = pixelmatch(image1.data, image2.data, null, image1.width, image2.height, { threshold: 0.01 });
    expect(count).toBe(0);
  }
  await headedBrowser.close();
});
