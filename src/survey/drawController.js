/**
 * Site Survey drawing: the Cesium + DOM half for the boundary and the
 * profile line.
 *
 * It follows the whiteboard Draw tool (src/annotations/drawTool.js) and reuses
 * its pure session (src/annotations/drawMode.js) and its world picking:
 * click vertices on the globe, double-click or Enter to finish, Backspace to
 * undo, Escape to cancel. While a session or an edit is open it HOLDS THE
 * POINTER (src/data/inputOwnership.js), so no layer selects what is under a
 * click, and it borrows Cesium's own click and double-click actions for the
 * session and gives them back afterwards — the same two rules Draw follows.
 *
 * Editing drags the finished boundary's vertex handles; a right click on a
 * handle removes that vertex while more than three remain.
 */
import * as Cesium from 'cesium';
import { pickWorldFromScreen } from '../annotations/annotationResolver.js';
import {
  addVertex,
  createDrawSession,
  finishReason,
  removeLastVertex,
} from '../annotations/drawMode.js';
import {
  claimPointer,
  pointerOwner,
  releasePointer,
} from '../data/inputOwnership.js';
import { pointerOwnerName } from '../data/pointerOwnerNames.js';
import { t, translateKnown } from '../i18n/index.js';

export const SURVEY_POINTER_OWNER = 'site-survey';

/**
 * @param {object} deps
 * @param {Cesium.Viewer} deps.viewer
 * @param {(kind:'boundary'|'profile', vertices:Array<{lon:number, lat:number}>) => void} deps.onFinish
 * @param {(state:{mode:string, vertices:Array, cursor:object|null}) => void} deps.onPreview
 * @param {(index:number, vertex:{lon:number, lat:number}) => void} deps.onVertexMoved
 * @param {(index:number) => void} deps.onVertexRemoved
 * @param {(text:string) => void} deps.onHint
 * @param {(entity:object) => number|null} deps.handleIndexOf picked entity → vertex index
 */
export function createSurveyDrawController({
  viewer,
  onFinish,
  onPreview,
  onVertexMoved,
  onVertexRemoved,
  onHint,
  handleIndexOf,
}) {
  /** 'idle' | 'boundary' | 'profile' | 'edit' */
  let mode = 'idle';
  let session = null;
  let cursor = null;
  let lease = null;
  let handler = null;
  let savedSingleClick = null;
  let savedDoubleClick = null;
  let dragIndex = null;
  let destroyed = false;

  const preview = () =>
    onPreview({ mode, vertices: session?.vertices || [], cursor });

  const hintFor = () => {
    if (mode === 'edit')
      return t(
        'Drag a corner to move it. Right-click a corner to remove it. Esc when done.',
      );
    if (!session) return '';
    const n = session.vertices.length;
    const need = (mode === 'boundary' ? 3 : 2) - n;
    if (need > 0)
      return mode === 'boundary'
        ? t('Click the boundary corners on the map. {count} more needed.', {
            count: need,
          })
        : t('Click points along the profile line. {count} more needed.', {
            count: need,
          });
    if (finishReason(session) === 'degenerate')
      return mode === 'boundary'
        ? t('Those corners are in a line — move one off it to enclose an area.')
        : t('That line has no length — click somewhere further away.');
    return t('Double-click or Enter to finish, Backspace undoes, Esc cancels.');
  };
  const hint = () => onHint(hintFor());

  const worldAt = (position) => {
    const canvas = viewer.scene.canvas;
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    return pickWorldFromScreen(viewer, position.x / w, position.y / h);
  };

  const camera = viewer.scene.screenSpaceCameraController;

  function onClick(event) {
    if (!session || destroyed) return;
    const p = worldAt(event.position);
    if (!p) {
      onHint(t('That point is off the globe — click on the world.'));
      return;
    }
    const { added } = addVertex(session, p);
    if (added) {
      preview();
      hint();
    }
  }
  function onMove(event) {
    if (destroyed) return;
    if (mode === 'edit') {
      if (dragIndex === null) return;
      const p = worldAt(event.endPosition);
      if (p) onVertexMoved(dragIndex, { lon: p.lon, lat: p.lat });
      return;
    }
    if (!session) return;
    const p = worldAt(event.endPosition);
    cursor = p ? { lon: p.lon, lat: p.lat, height: p.height || 0 } : null;
    preview();
  }
  function onDown(event) {
    if (mode !== 'edit' || destroyed) return;
    const picked = viewer.scene.pick(event.position);
    const index = picked?.id ? handleIndexOf(picked.id) : null;
    if (index === null || index === undefined) return;
    dragIndex = index;
    camera.enableInputs = false;
  }
  function onUp() {
    if (dragIndex === null) return;
    dragIndex = null;
    camera.enableInputs = true;
  }
  function onRightClick(event) {
    if (mode !== 'edit' || destroyed) return;
    const picked = viewer.scene.pick(event.position);
    const index = picked?.id ? handleIndexOf(picked.id) : null;
    if (index !== null && index !== undefined) onVertexRemoved(index);
  }

  function finish() {
    if (!session || destroyed) return false;
    const reason = finishReason(session);
    if (reason !== 'ok') {
      hint();
      return false;
    }
    const kind = mode;
    const vertices = session.vertices.map((v) => ({ lon: v.lon, lat: v.lat }));
    stop();
    onFinish(kind, vertices);
    return true;
  }

  const typingElsewhere = (event) => {
    const target = event.target;
    return (
      Boolean(target) &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    );
  };
  function onKey(event) {
    if (mode === 'idle' || destroyed || typingElsewhere(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      stop();
      return;
    }
    if (!session) return;
    if (event.key === 'Enter') {
      const target = event.target;
      if (target?.closest?.('button, a, select, [role="button"]')) return;
      event.preventDefault();
      finish();
      return;
    }
    if (event.key === 'Backspace' && removeLastVertex(session)) {
      event.preventDefault();
      preview();
      hint();
    }
  }

  function bind() {
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction(onMove, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    handler.setInputAction(onDown, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(onUp, Cesium.ScreenSpaceEventType.LEFT_UP);
    handler.setInputAction(
      onRightClick,
      Cesium.ScreenSpaceEventType.RIGHT_CLICK,
    );
    handler.setInputAction(() => {
      finish();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    // Borrow the viewer's own select and track actions for the session, as
    // the Draw tool does; they come back in unbind().
    const stock = viewer.screenSpaceEventHandler;
    savedSingleClick =
      stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) || null;
    savedDoubleClick =
      stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) ||
      null;
    stock.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    stock.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('gev-drawing');
  }
  function unbind() {
    handler?.destroy();
    handler = null;
    const stock = viewer.screenSpaceEventHandler;
    if (savedSingleClick && stock)
      stock.setInputAction(
        savedSingleClick,
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
    if (savedDoubleClick && stock)
      stock.setInputAction(
        savedDoubleClick,
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );
    savedSingleClick = null;
    savedDoubleClick = null;
    document.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('gev-drawing');
    if (dragIndex !== null) camera.enableInputs = true;
    dragIndex = null;
  }

  /** Begin a session; refuses (and says why) when another tool has the pointer. */
  function start(nextMode) {
    if (destroyed) return false;
    stop();
    lease = claimPointer(SURVEY_POINTER_OWNER);
    if (!lease) {
      onHint(
        t('{owner} is using the pointer — close it first.', {
          owner: translateKnown(pointerOwnerName(pointerOwner())),
        }),
      );
      return false;
    }
    mode = nextMode;
    session =
      nextMode === 'edit'
        ? null
        : createDrawSession(nextMode === 'boundary' ? 'area' : 'line');
    cursor = null;
    bind();
    preview();
    hint();
    return true;
  }

  /** End any session or edit without finishing it. */
  function stop() {
    const wasActive = mode !== 'idle';
    if (wasActive) unbind();
    releasePointer(lease);
    lease = null;
    mode = 'idle';
    session = null;
    cursor = null;
    if (wasActive) {
      preview();
      onHint('');
    }
  }

  return {
    get mode() {
      return mode;
    },
    startBoundary: () => start('boundary'),
    startProfile: () => start('profile'),
    startEdit: () => start('edit'),
    stop,
    finish,
    /** Test seam: add a vertex as if it had been clicked. */
    addVertex(lon, lat) {
      if (!session) return false;
      const result = addVertex(session, { lon, lat, height: 0 });
      if (result.added) {
        preview();
        hint();
      }
      return result.added;
    },
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
    },
  };
}
