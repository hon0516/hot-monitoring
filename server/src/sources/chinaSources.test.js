import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapBilibiliSearchResults, parseBilibiliSearchHtml, searchBilibili } from './bilibiliSource.js';
import { searchSogou, parseSogouSearchResults } from './sogouSource.js';
import { parseWeiboPublicHotResponse, parseWeiboRealtimePage, searchWeibo } from './weiboSource.js';
import { parseWeiboHotMarkdown, searchWeiboHot } from './weiboHotSource.js';

function recentDateText(time = '12:00') {
  return `${new Date().toISOString().slice(0, 10)} ${time}`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('china source runners', () => {
  it('maps bilibili search results', () => {
    const items = mapBilibiliSearchResults([
      {
        type: 'video',
        title: 'AI <em class="keyword">教程</em>',
        description: '从零开始',
        arcurl: 'http://www.bilibili.com/video/BV1abc',
        author: 'UP主',
        pubdate: 1773121651,
        play: 100,
        like: 10,
        review: 3,
        video_review: 2,
        favorites: 1
      }
    ]);

    expect(items[0]).toMatchObject({
      title: 'AI 教程',
      sourceType: 'bilibili',
      sourceAuthor: 'UP主'
    });
    expect(items[0].url).toBe('https://www.bilibili.com/video/BV1abc');
  });

  it('parses weibo realtime search html cards', () => {
    const html = `
      <div class="card-wrap" action-type="feed_list_item" mid="1">
        <div class="card-feed">
          <div class="content">
            <div class="info"><a class="name" href="/u/1">测试用户</a></div>
            <p node-type="feed_list_content">AI 发布会刚刚开始，很多细节值得看。</p>
            <div class="from">
              <a href="//weibo.com/1/abc">今天 12:30</a>
            </div>
          </div>
        </div>
        <div class="card-act">
          <ul>
            <li>转发 12</li>
            <li>评论 34</li>
            <li>赞 56</li>
          </ul>
        </div>
      </div>
    `;

    const items = parseWeiboRealtimePage(html);
    expect(items[0]).toMatchObject({
      sourceType: 'weibo',
      sourceAuthor: '测试用户'
    });
    expect(items[0].url).toBe('https://weibo.com/1/abc');
    expect(items[0].snippet).toContain('AI 发布会');
  });

  it('parses weibo public hot search response', () => {
    const items = parseWeiboPublicHotResponse(
      {
        ok: 1,
        data: {
          realtime: [
            { word: 'AI 模型发布', num: 123456 },
            { word: '体育新闻', num: 654321 }
          ]
        }
      },
      'AI'
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceType: 'weibo',
      sourceAuthor: '微博热搜',
      title: '微博热搜：AI 模型发布'
    });
  });

  it('parses sogou search results html', () => {
    const html = `
      <div class="results">
        <div class="vrwrap">
          <h3><a href="https://example.com/a">AI 行业观察</a></h3>
          <p class="str-text-info">最新资讯摘要</p>
          <div class="news-from">2026-04-22 12:30</div>
        </div>
      </div>
    `;

    const items = parseSogouSearchResults(html);
    expect(items[0]).toMatchObject({
      title: 'AI 行业观察',
      sourceType: 'sogou',
      sourceAuthor: '搜狗搜索'
    });
  });

  it('searchBilibili returns empty on malformed payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ code: 0, data: { result: [] } })
      })
    );

    await expect(searchBilibili({ keyword: 'AI', scope: 'Agent' })).resolves.toEqual([]);
  });

  it('parses bilibili search html as fallback results', () => {
    const html = `
      <div class="video-item">
        <a href="//www.bilibili.com/video/BV1abc" title="AI 视频解析">AI 视频解析</a>
        <div class="desc">一段摘要</div>
        <div class="up-name">测试 UP</div>
        <div class="time">2026-05-20 12:30</div>
      </div>
    `;

    const items = parseBilibiliSearchHtml(html);
    expect(items[0]).toMatchObject({
      title: 'AI 视频解析',
      sourceType: 'bilibili',
      sourceAuthor: '测试 UP',
      url: 'https://www.bilibili.com/video/BV1abc'
    });
  });

  it('ignores bilibili duration overlays when parsing fallback html', () => {
    const html = `
      <div class="video-item">
        <a href="//www.bilibili.com/video/BV1abc">00:17:22</a>
        <a class="video-title" href="//www.bilibili.com/video/BV1abc" title="AI 视频解析">AI 视频解析</a>
        <div class="desc">一段摘要</div>
        <div class="up-name">测试 UP</div>
      </div>
    `;

    const items = parseBilibiliSearchHtml(html);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'AI 视频解析',
      sourceAuthor: '测试 UP'
    });
  });

  it('searchBilibili falls back to html parsing after 412', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 412
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `
            <div class="video-item">
              <a href="//www.bilibili.com/video/BV1xyz" title="AI 新视频">AI 新视频</a>
              <div class="desc">HTML 兜底成功</div>
              <div class="up-name">兜底 UP</div>
            </div>
          `
        })
    );

    const items = await searchBilibili({ keyword: 'AI', scope: '' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'AI 新视频',
      sourceAuthor: '兜底 UP'
    });
  });

  it('searchWeibo filters hot list by query terms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: 1,
          data: {
            realtime: [
              { word: 'AI 模型发布', num: 100 },
              { word: '体育新闻', num: 50 }
            ]
          }
        })
      })
    );

    const items = await searchWeibo({ keyword: 'AI', scope: '' });
    expect(items).toHaveLength(1);
    expect(items[0].sourceType).toBe('weibo');
  });

  it('parses weibo hot markdown mirror', () => {
    const updatedAt = recentDateText();
    const items = parseWeiboHotMarkdown(`
      最后更新时间：${updatedAt}
      1. [AI 模型发布](https://s.weibo.com/weibo?q=%23AI%E6%A8%A1%E5%9E%8B%E5%8F%91%E5%B8%83%23) 100
      2. [体育新闻](https://s.weibo.com/weibo?q=%23%E4%BD%93%E8%82%B2%E6%96%B0%E9%97%BB%23) 50
    `);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: 'AI 模型发布',
      sourceType: 'weibo-hot',
      sourceAuthor: '微博热搜'
    });
  });

  it('searchWeiboHot filters mirror results by keyword', async () => {
    const updatedAt = recentDateText();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `
          最后更新时间：${updatedAt}
          1. [AI 模型发布](https://s.weibo.com/weibo?q=%23AI%E6%A8%A1%E5%9E%8B%E5%8F%91%E5%B8%83%23) 100
          2. [体育新闻](https://s.weibo.com/weibo?q=%23%E4%BD%93%E8%82%B2%E6%96%B0%E9%97%BB%23) 50
        `
      })
    );

    const items = await searchWeiboHot({ keyword: 'AI' });
    expect(items).toHaveLength(1);
    expect(items[0].sourceType).toBe('weibo-hot');
  });

  it('searchWeibo prefers realtime page results when accessible', async () => {
    const publishedAt = recentDateText('12:30');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `
          <div class="card-wrap" action-type="feed_list_item" mid="1">
            <div class="card-feed">
              <div class="content">
                <div class="info"><a class="name" href="/u/1">测试用户</a></div>
                <p node-type="feed_list_content">AI 新模型正式发布</p>
                <div class="from"><a href="//weibo.com/1/abc">${publishedAt}</a></div>
              </div>
            </div>
          </div>
        `
      })
    );

    const items = await searchWeibo({ keyword: 'AI', scope: '' });
    expect(items).toHaveLength(1);
    expect(items[0].snippet).toContain('AI 新模型正式发布');
  });

  it('searchSogou returns empty on challenge page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => '<title>Sina Visitor System</title>'
      })
    );

    await expect(searchSogou({ keyword: 'AI', scope: '' })).resolves.toEqual([]);
  });
});
