import React, { Children, cloneElement, forwardRef, useContext, useState, useMemo, useLayoutEffect, useEffect, useRef, useReducer, useCallback, memo } from 'react';
import ReactDOM, { unstable_batchedUpdates, createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import { useTransition } from 'react-transition-state';

const menuContainerClass = 'szh-menu-container';
const menuClass = 'szh-menu';
const menuButtonClass = 'szh-menu-button';
const menuArrowClass = 'arrow';
const menuItemClass = 'item';
const menuDividerClass = 'divider';
const menuHeaderClass = 'header';
const menuGroupClass = 'group';
const subMenuClass = 'submenu';
const radioGroupClass = 'radio-group';
const initialHoverIndex = -1;
const HoverIndexContext = /*#__PURE__*/React.createContext(initialHoverIndex);
const MenuListItemContext = /*#__PURE__*/React.createContext({});
const MenuListContext = /*#__PURE__*/React.createContext({});
const EventHandlersContext = /*#__PURE__*/React.createContext({});
const RadioGroupContext = /*#__PURE__*/React.createContext({});
const SettingsContext = /*#__PURE__*/React.createContext({});
const ItemSettingsContext = /*#__PURE__*/React.createContext({});
const Keys = Object.freeze({
  'TAB': 'Tab',
  'ENTER': 'Enter',
  'ESC': 'Escape',
  'SPACE': ' ',
  'HOME': 'Home',
  'END': 'End',
  'LEFT': 'ArrowLeft',
  'RIGHT': 'ArrowRight',
  'UP': 'ArrowUp',
  'DOWN': 'ArrowDown'
});
const HoverIndexActionTypes = Object.freeze({
  'RESET': 'HOVER_RESET',
  'SET': 'HOVER_SET',
  'UNSET': 'HOVER_UNSET',
  'INCREASE': 'HOVER_INCREASE',
  'DECREASE': 'HOVER_DECREASE',
  'FIRST': 'HOVER_FIRST',
  'LAST': 'HOVER_LAST'
});
const SubmenuActionTypes = Object.freeze({
  'OPEN': 'SUBMENU_OPEN',
  'CLOSE': 'SUBMENU_CLOSE'
});
const CloseReason = Object.freeze({
  'CLICK': 'click',
  'CANCEL': 'cancel',
  'BLUR': 'blur',
  'SCROLL': 'scroll'
});
const FocusPositions = Object.freeze({
  'INITIAL': 'initial',
  'FIRST': 'first',
  'LAST': 'last'
});
const MenuStateMap = Object.freeze({
  entering: 'opening',
  entered: 'open',
  exiting: 'closing',
  exited: 'closed'
});

const batchedUpdates = unstable_batchedUpdates || (callback => callback());
const values = Object.values || (obj => Object.keys(obj).map(key => obj[key]));
const floatEqual = (a, b, diff = 0.0001) => Math.abs(a - b) < diff;
const isProd = process.env.NODE_ENV === 'production';
const isMenuOpen = state => state === 'open' || state === 'opening';
const getTransition = (transition, name) => Boolean(transition && transition[name]) || transition === true;
const safeCall = (fn, ...args) => typeof fn === 'function' ? fn(...args) : fn;
const getName = component => component && component['_szhsinMenu'];
const defineName = (component, name) => name ? Object.defineProperty(component, '_szhsinMenu', {
  value: name,
  writable: false
}) : component;
const applyHOC = HOC => (...args) => defineName(HOC(...args), getName(args[0]));
const applyStatics = sourceComponent => wrappedComponent => defineName(wrappedComponent, getName(sourceComponent));
const attachHandlerProps = (handlers, props) => {
  if (!props) return handlers;
  const result = {};

  for (const handlerName of Object.keys(handlers)) {
    const handler = handlers[handlerName];
    const propHandler = props[handlerName];
    let attachedHandler;

    if (typeof propHandler === 'function') {
      attachedHandler = e => {
        propHandler(e);
        handler(e);
      };
    } else {
      attachedHandler = handler;
    }

    result[handlerName] = attachedHandler;
  }

  return result;
};
const parsePadding = paddingStr => {
  if (typeof paddingStr !== 'string') return {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  };
  const padding = paddingStr.trim().split(/\s+/, 4).map(parseFloat);
  const top = !isNaN(padding[0]) ? padding[0] : 0;
  const right = !isNaN(padding[1]) ? padding[1] : top;
  return {
    top,
    right,
    bottom: !isNaN(padding[2]) ? padding[2] : top,
    left: !isNaN(padding[3]) ? padding[3] : right
  };
};
const getScrollAncestor = node => {
  while (node && node !== document.body) {
    const {
      overflow,
      overflowX,
      overflowY
    } = getComputedStyle(node);
    if (/auto|scroll|overlay|hidden/.test(overflow + overflowY + overflowX)) return node;
    node = node.parentNode;
  }

  return window;
};
const validateIndex = (index, isDisabled, node) => {
  if (!isProd && index === undefined && !isDisabled) {
    const error = `[react-menu] Validate item '${node && node.toString()}' failed.
You're probably creating your own components or HOC over MenuItem, SubMenu or FocusableItem.
To create wrapping components, see: https://codesandbox.io/s/react-menu-wrapping-q0b59
To create HOCs, see: https://codesandbox.io/s/react-menu-hoc-0bipn`;
    throw new Error(error);
  }
};

const cloneChildren = (children, startIndex = 0, inRadioGroup) => {
  let index = startIndex;
  let descendOverflow = false;
  const items = Children.map(children, child => {
    if (child === undefined || child === null) return null;
    if (!child.type) return child;
    const name = getName(child.type);

    switch (name) {
      case 'MenuItem':
        {
          if (inRadioGroup) {
            const props = {
              type: 'radio'
            };
            if (!child.props.disabled) props.index = index++;
            return /*#__PURE__*/cloneElement(child, props);
          }
        }

      case 'SubMenu':
      case 'FocusableItem':
        return child.props.disabled ? child : /*#__PURE__*/cloneElement(child, {
          index: index++
        });

      default:
        {
          const innerChildren = child.props.children;
          if (innerChildren === null || typeof innerChildren !== "object") return child;
          const desc = cloneChildren(innerChildren, index, inRadioGroup || name === 'MenuRadioGroup');
          index = desc.index;

          if (name === 'MenuGroup') {
            const takeOverflow = Boolean(child.props.takeOverflow);
            const descOverflow = desc.descendOverflow;
            if (!isProd && (descendOverflow === descOverflow ? descOverflow : takeOverflow)) throw new Error('[react-menu] Only one MenuGroup in a menu is allowed to have takeOverflow prop.');
            descendOverflow = descendOverflow || descOverflow || takeOverflow;
          }

          return /*#__PURE__*/cloneElement(child, {
            children: desc.items
          });
        }
    }
  });
  return {
    items,
    index,
    descendOverflow
  };
};

const stylePropTypes = name => ({
  [name ? `${name}ClassName` : 'className']: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
  [name ? `${name}Styles` : 'styles']: PropTypes.oneOfType([PropTypes.object, PropTypes.func])
});
const sharedMenuPropTypes = {
  className: PropTypes.string,
  ...stylePropTypes('menu'),
  ...stylePropTypes('arrow'),
  arrow: PropTypes.bool,
  offsetX: PropTypes.number,
  offsetY: PropTypes.number,
  align: PropTypes.oneOf(['start', 'center', 'end']),
  direction: PropTypes.oneOf(['left', 'right', 'top', 'bottom']),
  position: PropTypes.oneOf(['auto', 'anchor', 'initial']),
  overflow: PropTypes.oneOf(['auto', 'visible', 'hidden'])
};
const menuPropTypesBase = { ...sharedMenuPropTypes,
  containerProps: PropTypes.object,
  initialMounted: PropTypes.bool,
  unmountOnClose: PropTypes.bool,
  transition: PropTypes.oneOfType([PropTypes.bool, PropTypes.exact({
    open: PropTypes.bool,
    close: PropTypes.bool,
    item: PropTypes.bool
  })]),
  transitionTimeout: PropTypes.number,
  boundingBoxRef: PropTypes.object,
  boundingBoxPadding: PropTypes.string,
  reposition: PropTypes.oneOf(['auto', 'initial']),
  repositionFlag: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  viewScroll: PropTypes.oneOf(['auto', 'close', 'initial']),
  submenuOpenDelay: PropTypes.number,
  submenuCloseDelay: PropTypes.number,
  portal: PropTypes.bool,
  theming: PropTypes.string,
  onItemClick: PropTypes.func
};
const sharedMenuDefaultProp = {
  offsetX: 0,
  offsetY: 0,
  align: 'start',
  direction: 'bottom',
  position: 'auto',
  overflow: 'visible'
};
const menuDefaultPropsBase = { ...sharedMenuDefaultProp,
  reposition: 'auto',
  viewScroll: 'initial',
  transitionTimeout: 200,
  submenuOpenDelay: 300,
  submenuCloseDelay: 150
};

const withHovering = (WrapppedComponent, name) => {
  const WithHovering = defineName( /*#__PURE__*/forwardRef((props, ref) => {
    return /*#__PURE__*/React.createElement(WrapppedComponent, Object.assign({}, props, {
      externalRef: ref,
      isHovering: useContext(HoverIndexContext) === props.index
    }));
  }), name);
  WithHovering.displayName = `WithHovering(${name})`;
  return WithHovering;
};

const useActiveState = (isHovering, isDisabled, ...moreKeys) => {
  const [active, setActive] = useState(false);
  const activeKeys = [Keys.SPACE, Keys.ENTER, ...moreKeys];

  const cancelActive = () => setActive(false);

  return {
    isActive: active,
    onPointerDown: () => {
      if (!isDisabled) setActive(true);
    },
    onPointerUp: cancelActive,
    onPointerLeave: cancelActive,
    onKeyDown: e => {
      if (isHovering && !isDisabled && activeKeys.includes(e.key)) {
        setActive(true);
      }
    },
    onKeyUp: e => {
      if (activeKeys.includes(e.key)) {
        setActive(false);
      }
    },
    onBlur: e => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setActive(false);
      }
    }
  };
};

const useBEM = ({
  block,
  element,
  modifiers,
  className
}) => useMemo(() => {
  const blockElement = element ? `${block}__${element}` : block;
  let classString = blockElement;

  for (const name of Object.keys(modifiers || {})) {
    const value = modifiers[name];

    if (value) {
      classString += ` ${blockElement}--`;
      classString += value === true ? name : `${name}-${value}`;
    }
  }

  let expandedClassName = typeof className === 'function' ? className(modifiers) : className;

  if (typeof expandedClassName === 'string') {
    expandedClassName = expandedClassName.trim();
    if (expandedClassName) classString += ` ${expandedClassName}`;
  }

  return classString;
}, [block, element, modifiers, className]);

const setRef = (ref, element) => {
  if (typeof ref === 'function') {
    ref(element);
  } else if (ref) {
    ref.current = element;
  }
};

const useCombinedRef = (refA, refB) => useMemo(() => {
  if (!refA) return refB;
  if (!refB) return refA;
  return element => {
    setRef(refA, element);
    setRef(refB, element);
  };
}, [refA, refB]);

const isObject = obj => obj && typeof obj === 'object';

const sanitiseKey = key => key.charAt(0) === '$' ? key.slice(1) : key;

const useFlatStyles = (styles, modifiers) => useMemo(() => {
  if (typeof styles === 'function') return styles(modifiers);
  if (!isObject(styles)) return undefined;
  if (!modifiers) return styles;
  const style = {};

  for (const prop of Object.keys(styles)) {
    const value = styles[prop];

    if (isObject(value)) {
      const modifierValue = modifiers[sanitiseKey(prop)];

      if (typeof modifierValue === 'string') {
        for (const nestedProp of Object.keys(value)) {
          const nestedValue = value[nestedProp];

          if (isObject(nestedValue)) {
            if (sanitiseKey(nestedProp) === modifierValue) {
              Object.assign(style, nestedValue);
            }
          } else {
            style[nestedProp] = nestedValue;
          }
        }
      } else if (modifierValue) {
        Object.assign(style, value);
      }
    } else {
      style[prop] = value;
    }
  }

  return style;
}, [styles, modifiers]);

const useIsomorphicLayoutEffect = typeof window !== 'undefined' && typeof window.document !== 'undefined' && typeof window.document.createElement !== 'undefined' ? useLayoutEffect : useEffect;

const useItemState = (ref, index, isHovering, isDisabled) => {
  const {
    submenuCloseDelay
  } = useContext(ItemSettingsContext);
  const {
    isParentOpen,
    isSubmenuOpen,
    dispatch
  } = useContext(MenuListItemContext);
  const timeoutId = useRef();

  const setHover = () => {
    if (!isDisabled) dispatch({
      type: HoverIndexActionTypes.SET,
      index
    });
  };

  const onBlur = e => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      dispatch({
        type: HoverIndexActionTypes.UNSET,
        index
      });
    }
  };

  const onMouseEnter = () => {
    if (isSubmenuOpen) {
      timeoutId.current = setTimeout(setHover, submenuCloseDelay);
    } else {
      setHover();
    }
  };

  const onMouseLeave = (_, keepHover) => {
    timeoutId.current && clearTimeout(timeoutId.current);
    if (!keepHover) dispatch({
      type: HoverIndexActionTypes.UNSET,
      index
    });
  };

  useEffect(() => () => clearTimeout(timeoutId.current), []);
  useEffect(() => {
    if (isHovering && isParentOpen) {
      ref.current && ref.current.focus();
    }
  }, [ref, isHovering, isParentOpen]);
  return {
    setHover,
    onBlur,
    onMouseEnter,
    onMouseLeave
  };
};

const useMenuChange = (onMenuChange, isOpen) => {
  const prevOpen = useRef(isOpen);
  useEffect(() => {
    if (prevOpen.current !== isOpen) safeCall(onMenuChange, {
      open: isOpen
    });
    prevOpen.current = isOpen;
  }, [onMenuChange, isOpen]);
};

const useMenuState = ({
  initialMounted,
  unmountOnClose,
  transition,
  transitionTimeout
} = {}) => {
  const [state, toggleMenu, endTransition] = useTransition({
    mountOnEnter: !initialMounted,
    unmountOnExit: unmountOnClose,
    timeout: transitionTimeout,
    enter: getTransition(transition, 'open'),
    exit: getTransition(transition, 'close')
  });
  return {
    state: MenuStateMap[state],
    toggleMenu,
    endTransition
  };
};

const useMenuStateAndFocus = options => {
  const menuState = useMenuState(options);
  const [menuItemFocus, setMenuItemFocus] = useState({
    position: FocusPositions.INITIAL
  });

  const openMenu = (position = FocusPositions.INITIAL) => {
    setMenuItemFocus({
      position
    });
    menuState.toggleMenu(true);
  };

  return { ...menuState,
    openMenu,
    menuItemFocus
  };
};

const MenuButton = defineName( /*#__PURE__*/forwardRef(function MenuButton({
  className,
  styles,
  isOpen,
  disabled,
  children,
  ...restProps
}, ref) {
  const modifiers = useMemo(() => Object.freeze({
    open: isOpen
  }), [isOpen]);
  return /*#__PURE__*/React.createElement("button", Object.assign({
    "aria-haspopup": true,
    "aria-expanded": isOpen,
    "aria-disabled": disabled || undefined,
    disabled: disabled
  }, restProps, {
    ref: ref,
    className: useBEM({
      block: menuButtonClass,
      modifiers,
      className
    }),
    style: useFlatStyles(styles, modifiers)
  }), children);
}), 'MenuButton');
MenuButton.propTypes = { ...stylePropTypes(),
  isOpen: PropTypes.bool,
  disabled: PropTypes.bool
};

const getPositionHelpers = ({
  menuRef,
  containerRef,
  scrollingRef,
  boundingBoxPadding
}) => {
  const menuRect = menuRef.current.getBoundingClientRect();
  const containerRect = containerRef.current.getBoundingClientRect();
  const boundingRect = scrollingRef.current === window ? {
    left: 0,
    top: 0,
    right: document.documentElement.clientWidth,
    bottom: window.innerHeight
  } : scrollingRef.current.getBoundingClientRect();
  const padding = parsePadding(boundingBoxPadding);

  const getLeftOverflow = x => x + containerRect.left - boundingRect.left - padding.left;

  const getRightOverflow = x => x + containerRect.left + menuRect.width - boundingRect.right + padding.right;

  const getTopOverflow = y => y + containerRect.top - boundingRect.top - padding.top;

  const getBottomOverflow = y => y + containerRect.top + menuRect.height - boundingRect.bottom + padding.bottom;

  const confineHorizontally = x => {
    let leftOverflow = getLeftOverflow(x);

    if (leftOverflow < 0) {
      x -= leftOverflow;
    } else {
      const rightOverflow = getRightOverflow(x);

      if (rightOverflow > 0) {
        x -= rightOverflow;
        leftOverflow = getLeftOverflow(x);
        if (leftOverflow < 0) x -= leftOverflow;
      }
    }

    return x;
  };

  const confineVertically = y => {
    let topOverflow = getTopOverflow(y);

    if (topOverflow < 0) {
      y -= topOverflow;
    } else {
      const bottomOverflow = getBottomOverflow(y);

      if (bottomOverflow > 0) {
        y -= bottomOverflow;
        topOverflow = getTopOverflow(y);
        if (topOverflow < 0) y -= topOverflow;
      }
    }

    return y;
  };

  return {
    menuRect,
    containerRect,
    getLeftOverflow,
    getRightOverflow,
    getTopOverflow,
    getBottomOverflow,
    confineHorizontally,
    confineVertically
  };
};

const positionContextMenu = ({
  positionHelpers,
  anchorPoint
}) => {
  const {
    menuRect,
    containerRect,
    getLeftOverflow,
    getRightOverflow,
    getTopOverflow,
    getBottomOverflow,
    confineHorizontally,
    confineVertically
  } = positionHelpers;
  let x, y;
  x = anchorPoint.x - containerRect.left;
  y = anchorPoint.y - containerRect.top;
  const rightOverflow = getRightOverflow(x);

  if (rightOverflow > 0) {
    const adjustedX = x - menuRect.width;
    const leftOverflow = getLeftOverflow(adjustedX);

    if (leftOverflow >= 0 || -leftOverflow < rightOverflow) {
      x = adjustedX;
    }

    x = confineHorizontally(x);
  }

  let computedDirection = 'bottom';
  const bottomOverflow = getBottomOverflow(y);

  if (bottomOverflow > 0) {
    const adjustedY = y - menuRect.height;
    const topOverflow = getTopOverflow(adjustedY);

    if (topOverflow >= 0 || -topOverflow < bottomOverflow) {
      y = adjustedY;
      computedDirection = 'top';
    }

    y = confineVertically(y);
  }

  return {
    x,
    y,
    computedDirection
  };
};

const placeArrowVertical = ({
  arrowRef,
  menuY,
  anchorRect,
  containerRect,
  menuRect
}) => {
  let y = anchorRect.top - containerRect.top - menuY + anchorRect.height / 2;
  const offset = arrowRef.current.offsetHeight * 1.25;
  y = Math.max(offset, y);
  y = Math.min(y, menuRect.height - offset);
  return y;
};

const placeLeftorRight = ({
  anchorRect,
  containerRect,
  menuRect,
  placeLeftorRightY,
  placeLeftX,
  placeRightX,
  getLeftOverflow,
  getRightOverflow,
  confineHorizontally,
  confineVertically,
  arrowRef,
  arrow,
  direction,
  position
}) => {
  let computedDirection = direction;
  let y = placeLeftorRightY;

  if (position !== 'initial') {
    y = confineVertically(y);

    if (position === 'anchor') {
      y = Math.min(y, anchorRect.bottom - containerRect.top);
      y = Math.max(y, anchorRect.top - containerRect.top - menuRect.height);
    }
  }

  let x, leftOverflow, rightOverflow;

  if (computedDirection === 'left') {
    x = placeLeftX;

    if (position !== 'initial') {
      leftOverflow = getLeftOverflow(x);

      if (leftOverflow < 0) {
        rightOverflow = getRightOverflow(placeRightX);

        if (rightOverflow <= 0 || -leftOverflow > rightOverflow) {
          x = placeRightX;
          computedDirection = 'right';
        }
      }
    }
  } else {
    x = placeRightX;

    if (position !== 'initial') {
      rightOverflow = getRightOverflow(x);

      if (rightOverflow > 0) {
        leftOverflow = getLeftOverflow(placeLeftX);

        if (leftOverflow >= 0 || -leftOverflow < rightOverflow) {
          x = placeLeftX;
          computedDirection = 'left';
        }
      }
    }
  }

  if (position === 'auto') x = confineHorizontally(x);
  const arrowY = arrow ? placeArrowVertical({
    menuY: y,
    arrowRef,
    anchorRect,
    containerRect,
    menuRect
  }) : undefined;
  return {
    arrowY,
    x,
    y,
    computedDirection
  };
};

const placeArrowHorizontal = ({
  arrowRef,
  menuX,
  anchorRect,
  containerRect,
  menuRect
}) => {
  let x = anchorRect.left - containerRect.left - menuX + anchorRect.width / 2;
  const offset = arrowRef.current.offsetWidth * 1.25;
  x = Math.max(offset, x);
  x = Math.min(x, menuRect.width - offset);
  return x;
};

const placeToporBottom = ({
  anchorRect,
  containerRect,
  menuRect,
  placeToporBottomX,
  placeTopY,
  placeBottomY,
  getTopOverflow,
  getBottomOverflow,
  confineHorizontally,
  confineVertically,
  arrowRef,
  arrow,
  direction,
  position
}) => {
  let computedDirection = direction === 'top' ? 'top' : 'bottom';
  let x = placeToporBottomX;

  if (position !== 'initial') {
    x = confineHorizontally(x);

    if (position === 'anchor') {
      x = Math.min(x, anchorRect.right - containerRect.left);
      x = Math.max(x, anchorRect.left - containerRect.left - menuRect.width);
    }
  }

  let y, topOverflow, bottomOverflow;

  if (computedDirection === 'top') {
    y = placeTopY;

    if (position !== 'initial') {
      topOverflow = getTopOverflow(y);

      if (topOverflow < 0) {
        bottomOverflow = getBottomOverflow(placeBottomY);

        if (bottomOverflow <= 0 || -topOverflow > bottomOverflow) {
          y = placeBottomY;
          computedDirection = 'bottom';
        }
      }
    }
  } else {
    y = placeBottomY;

    if (position !== 'initial') {
      bottomOverflow = getBottomOverflow(y);

      if (bottomOverflow > 0) {
        topOverflow = getTopOverflow(placeTopY);

        if (topOverflow >= 0 || -topOverflow < bottomOverflow) {
          y = placeTopY;
          computedDirection = 'top';
        }
      }
    }
  }

  if (position === 'auto') y = confineVertically(y);
  const arrowX = arrow ? placeArrowHorizontal({
    menuX: x,
    arrowRef,
    anchorRect,
    containerRect,
    menuRect
  }) : undefined;
  return {
    arrowX,
    x,
    y,
    computedDirection
  };
};

const positionMenu = ({
  arrow,
  align,
  direction,
  offsetX,
  offsetY,
  position,
  anchorRef,
  arrowRef,
  positionHelpers
}) => {
  const {
    menuRect,
    containerRect
  } = positionHelpers;
  let horizontalOffset = offsetX;
  let verticalOffset = offsetY;

  if (arrow) {
    if (direction === 'left' || direction === 'right') {
      horizontalOffset += arrowRef.current.offsetWidth;
    } else {
      verticalOffset += arrowRef.current.offsetHeight;
    }
  }

  const anchorRect = anchorRef.current.getBoundingClientRect();
  const placeLeftX = anchorRect.left - containerRect.left - menuRect.width - horizontalOffset;
  const placeRightX = anchorRect.right - containerRect.left + horizontalOffset;
  const placeTopY = anchorRect.top - containerRect.top - menuRect.height - verticalOffset;
  const placeBottomY = anchorRect.bottom - containerRect.top + verticalOffset;
  let placeToporBottomX, placeLeftorRightY;

  if (align === 'end') {
    placeToporBottomX = anchorRect.right - containerRect.left - menuRect.width;
    placeLeftorRightY = anchorRect.bottom - containerRect.top - menuRect.height;
  } else if (align === 'center') {
    placeToporBottomX = anchorRect.left - containerRect.left - (menuRect.width - anchorRect.width) / 2;
    placeLeftorRightY = anchorRect.top - containerRect.top - (menuRect.height - anchorRect.height) / 2;
  } else {
    placeToporBottomX = anchorRect.left - containerRect.left;
    placeLeftorRightY = anchorRect.top - containerRect.top;
  }

  placeToporBottomX += horizontalOffset;
  placeLeftorRightY += verticalOffset;
  const options = { ...positionHelpers,
    anchorRect,
    placeLeftX,
    placeRightX,
    placeLeftorRightY,
    placeTopY,
    placeBottomY,
    placeToporBottomX,
    arrowRef,
    arrow,
    direction,
    position
  };

  switch (direction) {
    case 'left':
    case 'right':
      return placeLeftorRight(options);

    case 'top':
    case 'bottom':
    default:
      return placeToporBottom(options);
  }
};

const SCROLL_UP_THRESHOLD = 8;
const SCROLL_DOWN_THRESHOLD = 16;
const MenuList = ({
  ariaLabel,
  menuClassName,
  menuStyles,
  arrowClassName,
  arrowStyles,
  anchorPoint,
  anchorRef,
  containerRef,
  externalRef,
  parentScrollingRef,
  arrow,
  align,
  direction,
  position,
  overflow,
  repositionFlag,
  captureFocus: _captureFocus = true,
  state: menuState,
  endTransition,
  isDisabled,
  menuItemFocus,
  offsetX,
  offsetY,
  children,
  onClose,
  skipNavigationKeys,
  scrollTopOffset,
  navigationEvent,
  navigationEventTimeStamp,
  ...restProps
}) => {
  const isOpen = isMenuOpen(menuState);
  const [menuPosition, setMenuPosition] = useState({
    x: 0,
    y: 0
  });
  const [arrowPosition, setArrowPosition] = useState({});
  const [overflowData, setOverflowData] = useState();
  const [expandedDirection, setExpandedDirection] = useState(direction);
  const {
    transition,
    boundingBoxRef,
    boundingBoxPadding,
    rootMenuRef,
    rootAnchorRef,
    scrollingRef,
    anchorScrollingRef,
    reposition,
    viewScroll
  } = useContext(SettingsContext);
  const menuRef = useRef(null);
  const arrowRef = useRef(null);
  const menuItemsCount = useRef(0);
  const prevOpen = useRef(isOpen);
  const latestMenuSize = useRef({
    width: 0,
    height: 0
  });
  const latestHandlePosition = useRef(() => {});
  const descendOverflowRef = useRef(false);
  const reposFlag = useContext(MenuListContext).reposSubmenu || repositionFlag;
  const [reposSubmenu, forceReposSubmenu] = useReducer(c => c + 1, 1);
  const [{
    hoverIndex,
    openSubmenuCount
  }, dispatch] = useReducer(reducer, {
    hoverIndex: initialHoverIndex,
    openSubmenuCount: 0
  });
  const openTransition = getTransition(transition, 'open');
  const closeTransition = getTransition(transition, 'close');

  function reducer({
    hoverIndex,
    openSubmenuCount
  }, action) {
    return {
      hoverIndex: hoverIndexReducer(hoverIndex, action),
      openSubmenuCount: submenuCountReducer(openSubmenuCount, action)
    };
  }

  function hoverIndexReducer(state, {
    type,
    index
  }) {
    switch (type) {
      case HoverIndexActionTypes.RESET:
        return initialHoverIndex;

      case HoverIndexActionTypes.SET:
        return index;

      case HoverIndexActionTypes.UNSET:
        return state === index ? initialHoverIndex : state;

      case HoverIndexActionTypes.DECREASE:
        {
          let i = state;
          i--;
          if (i < 0) i = menuItemsCount.current - 1;
          return i;
        }

      case HoverIndexActionTypes.INCREASE:
        {
          let i = state;
          i++;
          if (i >= menuItemsCount.current) i = 0;
          return i;
        }

      case HoverIndexActionTypes.FIRST:
        return menuItemsCount.current > 0 ? 0 : initialHoverIndex;

      case HoverIndexActionTypes.LAST:
        return menuItemsCount.current > 0 ? menuItemsCount.current - 1 : initialHoverIndex;

      default:
        return state;
    }
  }

  const menuItems = useMemo(() => {
    const {
      items,
      index,
      descendOverflow
    } = cloneChildren(children);
    menuItemsCount.current = index;
    descendOverflowRef.current = descendOverflow;
    return items;
  }, [children]);
  useEffect(() => {
    switch (navigationEvent) {
      case Keys.HOME:
        dispatch({
          type: HoverIndexActionTypes.FIRST
        });
        break;

      case Keys.END:
        dispatch({
          type: HoverIndexActionTypes.LAST
        });
        break;

      case Keys.UP:
        dispatch({
          type: HoverIndexActionTypes.DECREASE
        });
        break;

      case Keys.DOWN:
        dispatch({
          type: HoverIndexActionTypes.INCREASE
        });
        break;
    }
  }, [navigationEvent, navigationEventTimeStamp]);

  const handleKeyDown = e => {
    let handled = false;

    switch (e.key) {
      case Keys.HOME:
        dispatch({
          type: HoverIndexActionTypes.FIRST
        });
        handled = true;
        break;

      case Keys.END:
        dispatch({
          type: HoverIndexActionTypes.LAST
        });
        handled = true;
        break;

      case Keys.UP:
        dispatch({
          type: HoverIndexActionTypes.DECREASE
        });
        handled = true;
        break;

      case Keys.DOWN:
        dispatch({
          type: HoverIndexActionTypes.INCREASE
        });
        handled = true;
        break;

      case Keys.SPACE:
        if (e.target && e.target.className.includes(menuClass)) {
          e.preventDefault();
        }

        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleAnimationEnd = () => {
    if (menuState === 'closing') {
      setOverflowData();
    }

    safeCall(endTransition);
  };

  const handlePosition = useCallback(() => {
    if (!containerRef.current) {
      if (!isProd) throw new Error('[react-menu] Menu cannot be positioned properly as container ref is null. If you initialise isOpen prop to true for ControlledMenu, please see this link for a solution: https://github.com/szhsin/react-menu/issues/2#issuecomment-719166062');
      return;
    }

    if (!scrollingRef.current) {
      scrollingRef.current = boundingBoxRef ? boundingBoxRef.current : getScrollAncestor(rootMenuRef.current);
    }

    const positionHelpers = getPositionHelpers({
      menuRef,
      containerRef,
      scrollingRef,
      boundingBoxPadding
    });
    const {
      menuRect
    } = positionHelpers;
    let results = {
      computedDirection: 'bottom'
    };

    if (anchorPoint) {
      results = positionContextMenu({
        positionHelpers,
        anchorPoint
      });
    } else if (anchorRef) {
      results = positionMenu({
        arrow,
        align,
        direction,
        offsetX,
        offsetY,
        position,
        anchorRef,
        arrowRef,
        positionHelpers
      });
    }

    let {
      arrowX,
      arrowY,
      x,
      y,
      computedDirection
    } = results;
    let menuHeight = menuRect.height;

    if (overflow !== 'visible') {
      const {
        getTopOverflow,
        getBottomOverflow
      } = positionHelpers;
      let height, overflowAmt;
      const prevHeight = latestMenuSize.current.height;
      const bottomOverflow = getBottomOverflow(y);

      if (bottomOverflow > 0 || floatEqual(bottomOverflow, 0) && floatEqual(menuHeight, prevHeight)) {
        height = menuHeight - bottomOverflow;
        overflowAmt = bottomOverflow;
      } else {
        const topOverflow = getTopOverflow(y);

        if (topOverflow < 0 || floatEqual(topOverflow, 0) && floatEqual(menuHeight, prevHeight)) {
          height = menuHeight + topOverflow;
          overflowAmt = 0 - topOverflow;
          if (height >= 0) y -= topOverflow;
        }
      }

      if (height >= 0) {
        menuHeight = height;
        setOverflowData({
          height,
          overflowAmt
        });
      } else {
        setOverflowData();
      }
    }

    if (arrow) setArrowPosition({
      x: arrowX,
      y: arrowY
    });
    setMenuPosition({
      x,
      y
    });
    setExpandedDirection(computedDirection);
    latestMenuSize.current = {
      width: menuRect.width,
      height: menuHeight
    };
  }, [arrow, align, boundingBoxPadding, direction, offsetX, offsetY, position, overflow, anchorPoint, anchorRef, containerRef, boundingBoxRef, rootMenuRef, scrollingRef]);
  useIsomorphicLayoutEffect(() => {
    if (isOpen) {
      handlePosition();
      if (prevOpen.current) forceReposSubmenu();
    }

    prevOpen.current = isOpen;
    latestHandlePosition.current = handlePosition;
  }, [isOpen, handlePosition, reposFlag]);
  useIsomorphicLayoutEffect(() => {
    if (overflowData && !descendOverflowRef.current) menuRef.current.scrollTop = 0;
  }, [overflowData]);
  useEffect(() => {
    if (!isOpen) return;

    if (!anchorScrollingRef.current && rootAnchorRef && rootAnchorRef.current.tagName) {
      anchorScrollingRef.current = getScrollAncestor(rootAnchorRef.current);
    }

    const scrollCurrent = scrollingRef.current;
    const menuScroll = scrollCurrent && scrollCurrent.addEventListener ? scrollCurrent : window;
    const anchorScroll = anchorScrollingRef.current || menuScroll;
    let scroll = viewScroll;
    if (anchorScroll !== menuScroll && scroll === 'initial') scroll = 'auto';
    if (scroll === 'initial') return;
    if (scroll === 'auto' && overflow !== 'visible') scroll = 'close';

    const handleScroll = () => {
      if (scroll === 'auto') {
        batchedUpdates(handlePosition);
      } else {
        safeCall(onClose, {
          reason: CloseReason.SCROLL
        });
      }
    };

    const scrollObservers = anchorScroll !== menuScroll && viewScroll !== 'initial' ? [anchorScroll, menuScroll] : [anchorScroll];
    scrollObservers.forEach(o => o.addEventListener('scroll', handleScroll));
    return () => scrollObservers.forEach(o => o.removeEventListener('scroll', handleScroll));
  }, [rootAnchorRef, anchorScrollingRef, scrollingRef, isOpen, overflow, onClose, viewScroll, handlePosition]);
  const hasOverflow = Boolean(overflowData) && overflowData.overflowAmt > 0;
  useEffect(() => {
    if (hasOverflow || !isOpen || !parentScrollingRef) return;

    const handleScroll = () => batchedUpdates(handlePosition);

    const parentScroll = parentScrollingRef.current;
    parentScroll.addEventListener('scroll', handleScroll);
    return () => parentScroll.removeEventListener('scroll', handleScroll);
  }, [isOpen, hasOverflow, parentScrollingRef, handlePosition]);
  useEffect(() => {
    if (typeof ResizeObserver !== 'function' || reposition === 'initial') return;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const {
        borderBoxSize,
        target
      } = entry;
      let width, height;

      if (borderBoxSize) {
        const {
          inlineSize,
          blockSize
        } = borderBoxSize[0] || borderBoxSize;
        width = inlineSize;
        height = blockSize;
      } else {
        const borderRect = target.getBoundingClientRect();
        width = borderRect.width;
        height = borderRect.height;
      }

      if (width === 0 || height === 0) return;
      if (floatEqual(width, latestMenuSize.current.width, 1) && floatEqual(height, latestMenuSize.current.height, 1)) return;
      batchedUpdates(() => {
        latestHandlePosition.current();
        forceReposSubmenu();
      });
    });
    const observeTarget = menuRef.current;
    resizeObserver.observe(observeTarget, {
      box: 'border-box'
    });
    return () => resizeObserver.unobserve(observeTarget);
  }, [reposition]);
  useEffect(() => {
    if (!isOpen) {
      dispatch({
        type: HoverIndexActionTypes.RESET
      });
      if (!closeTransition) setOverflowData();
    }

    const id = setTimeout(() => {
      if (!isOpen || !menuRef.current || menuRef.current.contains(document.activeElement)) return;
      if (_captureFocus) menuRef.current.focus();

      if (menuItemFocus.position === FocusPositions.FIRST && hoverIndex === -1) {
        dispatch({
          type: HoverIndexActionTypes.FIRST
        });
      } else if (menuItemFocus.position === FocusPositions.LAST) {
        dispatch({
          type: HoverIndexActionTypes.LAST
        });
      }
    }, openTransition ? 170 : 100);
    return () => clearTimeout(id);
  }, [openTransition, closeTransition, _captureFocus, isOpen, menuItemFocus]);
  useEffect(() => {
    if (skipNavigationKeys && hoverIndex >= 0) {
      var _menuRef$current, _menuRef$current2;

      const element = document.getElementsByClassName('szh-menu__item')[hoverIndex];
      const scrollTop = (menuRef === null || menuRef === void 0 ? void 0 : (_menuRef$current = menuRef.current) === null || _menuRef$current === void 0 ? void 0 : _menuRef$current.scrollTop) || 0;
      const scrollClientHeight = (menuRef === null || menuRef === void 0 ? void 0 : (_menuRef$current2 = menuRef.current) === null || _menuRef$current2 === void 0 ? void 0 : _menuRef$current2.clientHeight) || 0;
      const bounding = element && element.getBoundingClientRect();
      const downThreshold = (bounding ? bounding.height : 0) + SCROLL_DOWN_THRESHOLD;
      const bottomPositionCutoff = scrollClientHeight - downThreshold;

      if (element && element.offsetTop - SCROLL_UP_THRESHOLD <= scrollTop) {
        var _menuRef$current3;

        const newScrollTop = element.offsetTop - SCROLL_UP_THRESHOLD;
        menuRef === null || menuRef === void 0 ? void 0 : (_menuRef$current3 = menuRef.current) === null || _menuRef$current3 === void 0 ? void 0 : _menuRef$current3.scrollTo(0, newScrollTop);
      } else if (bounding && bounding.top - scrollTopOffset >= bottomPositionCutoff) {
        var _menuRef$current4;

        const newScrollTop = bounding.top - scrollTopOffset - scrollClientHeight + scrollTop + downThreshold;
        menuRef === null || menuRef === void 0 ? void 0 : (_menuRef$current4 = menuRef.current) === null || _menuRef$current4 === void 0 ? void 0 : _menuRef$current4.scrollTo(0, newScrollTop);
      }
    }
  }, [skipNavigationKeys, scrollTopOffset, hoverIndex, menuRef]);
  const isSubmenuOpen = openSubmenuCount > 0;
  const itemContext = useMemo(() => ({
    parentMenuRef: menuRef,
    parentOverflow: overflow,
    isParentOpen: isOpen,
    isSubmenuOpen,
    dispatch
  }), [isOpen, isSubmenuOpen, overflow]);
  let maxHeight, overflowAmt;

  if (overflowData) {
    descendOverflowRef.current ? overflowAmt = overflowData.overflowAmt : maxHeight = overflowData.height;
  }

  const listContext = useMemo(() => ({
    reposSubmenu,
    overflow,
    overflowAmt
  }), [reposSubmenu, overflow, overflowAmt]);
  const overflowStyles = maxHeight >= 0 ? {
    maxHeight,
    overflow
  } : undefined;
  const modifiers = useMemo(() => ({
    state: menuState,
    dir: expandedDirection
  }), [menuState, expandedDirection]);
  const arrowModifiers = useMemo(() => Object.freeze({
    dir: expandedDirection
  }), [expandedDirection]);

  const _arrowClass = useBEM({
    block: menuClass,
    element: menuArrowClass,
    modifiers: arrowModifiers,
    className: arrowClassName
  });

  const _arrowStyles = useFlatStyles(arrowStyles, arrowModifiers);

  const handlers = attachHandlerProps({
    onKeyDown: skipNavigationKeys ? undefined : handleKeyDown,
    onAnimationEnd: handleAnimationEnd
  }, restProps);
  return /*#__PURE__*/React.createElement("ul", Object.assign({
    role: "menu",
    tabIndex: "-1",
    "aria-disabled": isDisabled || undefined,
    "aria-label": ariaLabel
  }, restProps, handlers, {
    ref: useCombinedRef(externalRef, menuRef),
    className: useBEM({
      block: menuClass,
      modifiers,
      className: menuClassName
    }),
    style: { ...useFlatStyles(menuStyles, modifiers),
      ...overflowStyles,
      left: `${menuPosition.x}px`,
      top: `${menuPosition.y}px`
    }
  }), arrow && /*#__PURE__*/React.createElement("div", {
    className: _arrowClass,
    style: { ..._arrowStyles,
      left: arrowPosition.x && `${arrowPosition.x}px`,
      top: arrowPosition.y && `${arrowPosition.y}px`
    },
    ref: arrowRef
  }), /*#__PURE__*/React.createElement(MenuListContext.Provider, {
    value: listContext
  }, /*#__PURE__*/React.createElement(MenuListItemContext.Provider, {
    value: itemContext
  }, /*#__PURE__*/React.createElement(HoverIndexContext.Provider, {
    value: hoverIndex
  }, menuItems))));
};

function submenuCountReducer(state, {
  type
}) {
  switch (type) {
    case SubmenuActionTypes.OPEN:
      return state + 1;

    case SubmenuActionTypes.CLOSE:
      return Math.max(state - 1, 0);

    default:
      return state;
  }
}

const ControlledMenu = /*#__PURE__*/forwardRef(function ControlledMenu({
  'aria-label': ariaLabel,
  className,
  containerProps,
  initialMounted,
  unmountOnClose,
  transition,
  transitionTimeout,
  boundingBoxRef,
  boundingBoxPadding,
  reposition,
  submenuOpenDelay,
  submenuCloseDelay,
  skipOpen,
  viewScroll,
  portal,
  theming,
  onItemClick,
  onClose,
  skipNavigationKeys = false,
  navigationEvent,
  navigationEventTimeStamp,
  ...restProps
}, externalRef) {
  const containerRef = useRef(null);
  const scrollingRef = useRef(null);
  const anchorScrollingRef = useRef(null);
  const {
    anchorRef,
    state
  } = restProps;
  const settings = useMemo(() => ({
    initialMounted,
    unmountOnClose,
    transition,
    transitionTimeout,
    boundingBoxRef,
    boundingBoxPadding,
    rootMenuRef: containerRef,
    rootAnchorRef: anchorRef,
    scrollingRef,
    anchorScrollingRef,
    reposition,
    viewScroll
  }), [initialMounted, unmountOnClose, transition, transitionTimeout, anchorRef, boundingBoxRef, boundingBoxPadding, reposition, viewScroll]);
  const itemSettings = useMemo(() => ({
    submenuOpenDelay,
    submenuCloseDelay
  }), [submenuOpenDelay, submenuCloseDelay]);
  const eventHandlers = useMemo(() => ({
    handleClick(event, isCheckorRadio) {
      if (!event.stopPropagation) safeCall(onItemClick, event);
      let keepOpen = event.keepOpen;

      if (keepOpen === undefined) {
        keepOpen = isCheckorRadio && event.key === Keys.SPACE;
      }

      if (!keepOpen) {
        safeCall(onClose, {
          value: event.value,
          key: event.key,
          reason: CloseReason.CLICK
        });
      }
    },

    handleClose(key) {
      safeCall(onClose, {
        key,
        reason: CloseReason.CLICK
      });
    }

  }), [onItemClick, onClose]);

  const handleKeyDown = ({
    key
  }) => {
    switch (key) {
      case Keys.ESC:
        safeCall(onClose, {
          key,
          reason: CloseReason.CANCEL
        });
        break;
    }
  };

  const handleBlur = e => {
    if (isMenuOpen(state) && !e.currentTarget.contains(e.relatedTarget || document.activeElement)) {
      safeCall(onClose, {
        reason: CloseReason.BLUR
      });

      if (skipOpen) {
        skipOpen.current = true;
        setTimeout(() => skipOpen.current = false, 300);
      }
    }
  };

  const itemTransition = getTransition(transition, 'item');
  const modifiers = useMemo(() => ({
    theme: theming,
    itemTransition
  }), [theming, itemTransition]);
  const handlers = attachHandlerProps({
    onKeyDown: handleKeyDown,
    onBlur: handleBlur
  }, containerProps);
  const menuList = /*#__PURE__*/React.createElement("div", Object.assign({}, containerProps, handlers, {
    className: useBEM({
      block: menuContainerClass,
      modifiers,
      className
    }),
    ref: containerRef
  }), state && /*#__PURE__*/React.createElement(SettingsContext.Provider, {
    value: settings
  }, /*#__PURE__*/React.createElement(ItemSettingsContext.Provider, {
    value: itemSettings
  }, /*#__PURE__*/React.createElement(EventHandlersContext.Provider, {
    value: eventHandlers
  }, /*#__PURE__*/React.createElement(MenuList, Object.assign({}, restProps, {
    ariaLabel: ariaLabel || 'Menu',
    externalRef: externalRef,
    containerRef: containerRef,
    skipNavigationKeys: skipNavigationKeys,
    navigationEvent: navigationEvent,
    navigationEventTimeStamp: navigationEventTimeStamp,
    onClose: onClose
  }))))));

  if (portal) {
    return /*#__PURE__*/ReactDOM.createPortal(menuList, document.body);
  } else {
    return menuList;
  }
});
ControlledMenu.propTypes = { ...menuPropTypesBase,
  state: PropTypes.oneOf(values(MenuStateMap)),
  anchorPoint: PropTypes.exact({
    x: PropTypes.number,
    y: PropTypes.number
  }),
  anchorRef: PropTypes.object,
  skipOpen: PropTypes.object,
  captureFocus: PropTypes.bool,
  menuItemFocus: PropTypes.exact({
    position: PropTypes.string
  }),
  onClose: PropTypes.func,
  skipNavigationKeys: PropTypes.bool
};
ControlledMenu.defaultProps = { ...menuDefaultPropsBase,
  menuItemFocus: {
    position: FocusPositions.INITIAL
  }
};

const Menu = /*#__PURE__*/forwardRef(function Menu({
  'aria-label': ariaLabel,
  captureFocus: _,
  menuButton,
  onMenuChange,
  ...restProps
}, externalRef) {
  const {
    openMenu,
    toggleMenu,
    ...stateProps
  } = useMenuStateAndFocus(restProps);
  const isOpen = isMenuOpen(stateProps.state);
  const skipOpen = useRef(false);
  const buttonRef = useRef(null);
  const handleClose = useCallback(e => {
    toggleMenu(false);
    if (e.key) buttonRef.current.focus();
  }, [toggleMenu]);

  const handleClick = e => {
    if (skipOpen.current) return;
    openMenu(e.detail === 0 ? FocusPositions.FIRST : FocusPositions.INITIAL);
  };

  const handleKeyDown = e => {
    let handled = false;

    switch (e.key) {
      case Keys.UP:
        openMenu(FocusPositions.LAST);
        handled = true;
        break;

      case Keys.DOWN:
        openMenu(FocusPositions.FIRST);
        handled = true;
        break;
    }

    if (handled) e.preventDefault();
  };

  const button = safeCall(menuButton, {
    open: isOpen
  });
  if (!button) throw new Error('Menu requires a menuButton prop.');
  const buttonProps = {
    ref: useCombinedRef(button.ref, buttonRef),
    ...attachHandlerProps({
      onClick: handleClick,
      onKeyDown: handleKeyDown
    }, button.props)
  };

  if (getName(button.type) === 'MenuButton') {
    buttonProps.isOpen = isOpen;
  }

  const renderButton = /*#__PURE__*/React.cloneElement(button, buttonProps);
  useMenuChange(onMenuChange, isOpen);
  const menuProps = { ...restProps,
    ...stateProps,
    'aria-label': ariaLabel || (typeof button.props.children === 'string' ? button.props.children : 'Menu'),
    anchorRef: buttonRef,
    ref: externalRef,
    onClose: handleClose,
    skipOpen
  };
  return /*#__PURE__*/React.createElement(React.Fragment, null, renderButton, /*#__PURE__*/React.createElement(ControlledMenu, menuProps));
});
Menu.propTypes = { ...menuPropTypesBase,
  menuButton: PropTypes.oneOfType([PropTypes.element, PropTypes.func]).isRequired,
  onMenuChange: PropTypes.func
};
Menu.defaultProps = menuDefaultPropsBase;

const SubMenu = withHovering( /*#__PURE__*/memo(function SubMenu({
  'aria-label': ariaLabel,
  className,
  disabled,
  label,
  index,
  onMenuChange,
  isHovering,
  captureFocus: _1,
  repositionFlag: _2,
  itemProps = {},
  ...restProps
}) {
  const isDisabled = Boolean(disabled);
  validateIndex(index, isDisabled, label);
  const {
    initialMounted,
    unmountOnClose,
    transition,
    transitionTimeout,
    rootMenuRef
  } = useContext(SettingsContext);
  const {
    submenuOpenDelay,
    submenuCloseDelay
  } = useContext(ItemSettingsContext);
  const {
    parentMenuRef,
    parentOverflow,
    isParentOpen,
    isSubmenuOpen,
    dispatch
  } = useContext(MenuListItemContext);
  const isPortal = parentOverflow !== 'visible';
  const {
    openMenu,
    toggleMenu,
    state,
    ...otherStateProps
  } = useMenuStateAndFocus({
    initialMounted,
    unmountOnClose,
    transition,
    transitionTimeout
  });
  const isOpen = isMenuOpen(state);
  const {
    isActive,
    onKeyUp,
    ...activeStateHandlers
  } = useActiveState(isHovering, isDisabled, Keys.RIGHT);
  const containerRef = useRef(null);
  const itemRef = useRef(null);
  const timeoutId = useRef();

  const delayOpen = delay => {
    dispatch({
      type: HoverIndexActionTypes.SET,
      index
    });
    timeoutId.current = setTimeout(openMenu, Math.max(delay, 0));
  };

  const handleMouseEnter = () => {
    if (isDisabled || isOpen) return;

    if (isSubmenuOpen) {
      timeoutId.current = setTimeout(() => delayOpen(submenuOpenDelay - submenuCloseDelay), submenuCloseDelay);
    } else {
      delayOpen(submenuOpenDelay);
    }
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutId.current);

    if (!isOpen) {
      dispatch({
        type: HoverIndexActionTypes.UNSET,
        index
      });
    }
  };

  const handleClick = () => {
    if (isDisabled) return;
    clearTimeout(timeoutId.current);
    openMenu();
  };

  const handleKeyDown = e => {
    let handled = false;

    switch (e.key) {
      case Keys.LEFT:
        if (isOpen) {
          toggleMenu(false);
          itemRef.current.focus();
          handled = true;
        }

        break;

      case Keys.RIGHT:
        if (!isOpen) handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleKeyUp = e => {
    if (!isActive) return;
    onKeyUp(e);

    switch (e.key) {
      case Keys.SPACE:
      case Keys.ENTER:
      case Keys.RIGHT:
        openMenu(FocusPositions.FIRST);
        break;
    }
  };

  useEffect(() => () => clearTimeout(timeoutId.current), []);
  useEffect(() => {
    if (isHovering && isParentOpen) {
      itemRef.current.focus();
    } else {
      toggleMenu(false);
    }
  }, [isHovering, isParentOpen, toggleMenu]);
  useEffect(() => {
    dispatch({
      type: isOpen ? SubmenuActionTypes.OPEN : SubmenuActionTypes.CLOSE
    });
  }, [dispatch, isOpen]);
  useMenuChange(onMenuChange, isOpen);
  const modifiers = useMemo(() => Object.freeze({
    open: isOpen,
    hover: isHovering,
    active: isActive,
    disabled: isDisabled
  }), [isOpen, isHovering, isActive, isDisabled]);
  const {
    ref: externaItemlRef,
    className: itemClassName,
    styles: itemStyles,
    ...restItemProps
  } = itemProps;
  const itemHandlers = attachHandlerProps({ ...activeStateHandlers,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onMouseDown: () => !isHovering && dispatch({
      type: HoverIndexActionTypes.SET,
      index
    }),
    onClick: handleClick,
    onKeyUp: handleKeyUp
  }, restItemProps);

  const getMenuList = () => {
    const menuList = /*#__PURE__*/React.createElement(MenuList, Object.assign({}, restProps, otherStateProps, {
      state: state,
      ariaLabel: ariaLabel || (typeof label === 'string' ? label : 'Submenu'),
      anchorRef: itemRef,
      containerRef: isPortal ? rootMenuRef : containerRef,
      parentScrollingRef: isPortal && parentMenuRef,
      isDisabled: isDisabled
    }));
    return isPortal ? /*#__PURE__*/createPortal(menuList, rootMenuRef.current) : menuList;
  };

  return /*#__PURE__*/React.createElement("li", {
    className: useBEM({
      block: menuClass,
      element: subMenuClass,
      className
    }),
    role: "presentation",
    ref: containerRef,
    onKeyDown: handleKeyDown
  }, /*#__PURE__*/React.createElement("div", Object.assign({
    role: "menuitem",
    "aria-haspopup": true,
    "aria-expanded": isOpen,
    "aria-disabled": isDisabled || undefined,
    tabIndex: isHovering && !isOpen ? 0 : -1
  }, restItemProps, itemHandlers, {
    ref: useCombinedRef(externaItemlRef, itemRef),
    className: useBEM({
      block: menuClass,
      element: menuItemClass,
      modifiers,
      className: itemClassName
    }),
    style: useFlatStyles(itemStyles, modifiers)
  }), useMemo(() => safeCall(label, modifiers), [label, modifiers])), state && getMenuList());
}), 'SubMenu');
SubMenu.propTypes = { ...sharedMenuPropTypes,
  disabled: PropTypes.bool,
  label: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  itemProps: PropTypes.shape({ ...stylePropTypes()
  }),
  onMenuChange: PropTypes.func
};
SubMenu.defaultProps = { ...sharedMenuDefaultProp,
  direction: 'right'
};

const MenuItem = withHovering( /*#__PURE__*/memo(function MenuItem({
  className,
  styles,
  value,
  href,
  type,
  checked,
  disabled,
  index,
  children,
  onClick,
  isHovering,
  externalRef,
  skipNavigationKeys = false,
  navigationEvent,
  ...restProps
}) {
  const isDisabled = Boolean(disabled);
  validateIndex(index, isDisabled, children);
  const ref = useRef();
  const {
    setHover,
    onBlur,
    onMouseEnter,
    onMouseLeave
  } = useItemState(ref, index, isHovering, isDisabled);
  const eventHandlers = useContext(EventHandlersContext);
  const radioGroup = useContext(RadioGroupContext);
  const {
    isActive,
    onKeyUp,
    onBlur: activeStateBlur,
    ...activeStateHandlers
  } = useActiveState(isHovering, isDisabled);
  const isRadio = type === 'radio';
  const isCheckBox = type === 'checkbox';
  const isAnchor = Boolean(href) && !isDisabled && !isRadio && !isCheckBox;
  const isChecked = isRadio ? radioGroup.value === value : isCheckBox ? Boolean(checked) : false;
  useEffect(() => {
    if (!isHovering) return;

    switch (navigationEvent) {
      case Keys.TAB:
      case Keys.ENTER:
        ref.current.click();
    }
  }, [isHovering, navigationEvent]);

  const handleClick = e => {
    if (isDisabled) return;
    const event = {
      value,
      syntheticEvent: e
    };
    if (e.key !== undefined) event.key = e.key;
    if (isCheckBox) event.checked = !isChecked;

    if (isRadio) {
      event.name = radioGroup.name;
      safeCall(radioGroup.onRadioChange, event);
    }

    if (!event.stopPropagation) safeCall(onClick, event);
    eventHandlers.handleClick(event, isCheckBox || isRadio);
  };

  const handleKeyUp = e => {
    if (!isActive) return;
    onKeyUp(e);

    switch (e.key) {
      case Keys.SPACE:
      case Keys.ENTER:
        if (isAnchor) {
          ref.current.click();
        } else {
          handleClick(e);
        }

        break;
    }
  };

  const handleBlur = e => {
    activeStateBlur(e);
    onBlur(e);
  };

  const modifiers = useMemo(() => Object.freeze({
    type,
    disabled: isDisabled,
    hover: isHovering,
    active: isActive,
    checked: isChecked,
    anchor: isAnchor
  }), [type, isDisabled, isHovering, isActive, isChecked, isAnchor]);
  const handlers = attachHandlerProps({ ...activeStateHandlers,
    onMouseEnter,
    onMouseLeave,
    onMouseDown: setHover,
    onKeyUp: handleKeyUp,
    onBlur: handleBlur,
    onClick: handleClick
  }, restProps);
  const menuItemProps = {
    role: isRadio ? 'menuitemradio' : isCheckBox ? 'menuitemcheckbox' : 'menuitem',
    'aria-checked': isRadio || isCheckBox ? isChecked : undefined,
    'aria-disabled': isDisabled || undefined,
    tabIndex: skipNavigationKeys ? undefined : isHovering ? 0 : -1,
    ...restProps,
    ...handlers,
    ref: useCombinedRef(externalRef, ref),
    className: useBEM({
      block: menuClass,
      element: menuItemClass,
      modifiers,
      className
    }),
    style: useFlatStyles(styles, modifiers)
  };
  const renderChildren = useMemo(() => safeCall(children, modifiers), [children, modifiers]);

  if (isAnchor) {
    return /*#__PURE__*/React.createElement("li", {
      role: "presentation"
    }, /*#__PURE__*/React.createElement("a", Object.assign({}, menuItemProps, {
      href: href
    }), renderChildren));
  } else {
    return /*#__PURE__*/React.createElement("li", menuItemProps, renderChildren);
  }
}), 'MenuItem');
MenuItem.propTypes = { ...stylePropTypes(),
  value: PropTypes.any,
  href: PropTypes.string,
  type: PropTypes.oneOf(['checkbox', 'radio']),
  checked: PropTypes.bool,
  disabled: PropTypes.bool,
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  onClick: PropTypes.func
};

const FocusableItem = withHovering( /*#__PURE__*/memo(function FocusableItem({
  className,
  styles,
  disabled,
  index,
  children,
  isHovering,
  externalRef,
  ...restProps
}) {
  const isDisabled = Boolean(disabled);
  validateIndex(index, isDisabled, children);
  const ref = useRef(null);
  const {
    setHover,
    onBlur,
    onMouseEnter,
    onMouseLeave
  } = useItemState(ref, index, isHovering, isDisabled);
  const {
    handleClose
  } = useContext(EventHandlersContext);
  const modifiers = useMemo(() => Object.freeze({
    disabled: isDisabled,
    hover: isHovering,
    focusable: true
  }), [isDisabled, isHovering]);
  const renderChildren = useMemo(() => safeCall(children, { ...modifiers,
    ref,
    closeMenu: handleClose
  }), [children, modifiers, handleClose]);
  const handlers = attachHandlerProps({
    onMouseEnter,
    onMouseLeave: e => onMouseLeave(e, true),
    onFocus: setHover,
    onBlur
  }, restProps);
  return /*#__PURE__*/React.createElement("li", Object.assign({
    "aria-disabled": isDisabled || undefined,
    role: "menuitem",
    tabIndex: "-1"
  }, restProps, handlers, {
    ref: externalRef,
    className: useBEM({
      block: menuClass,
      element: menuItemClass,
      modifiers,
      className
    }),
    style: useFlatStyles(styles, modifiers)
  }), renderChildren);
}), 'FocusableItem');
FocusableItem.propTypes = { ...stylePropTypes(),
  disabled: PropTypes.bool,
  children: PropTypes.func
};

const MenuDivider = /*#__PURE__*/memo( /*#__PURE__*/forwardRef(function MenuDivider({
  className,
  styles,
  ...restProps
}, externalRef) {
  return /*#__PURE__*/React.createElement("li", Object.assign({
    role: "separator"
  }, restProps, {
    ref: externalRef,
    className: useBEM({
      block: menuClass,
      element: menuDividerClass,
      className
    }),
    style: useFlatStyles(styles)
  }));
}));
MenuDivider.propTypes = { ...stylePropTypes()
};

const MenuHeader = /*#__PURE__*/memo( /*#__PURE__*/forwardRef(function MenuHeader({
  className,
  styles,
  ...restProps
}, externalRef) {
  return /*#__PURE__*/React.createElement("li", Object.assign({
    role: "presentation"
  }, restProps, {
    ref: externalRef,
    className: useBEM({
      block: menuClass,
      element: menuHeaderClass,
      className
    }),
    style: useFlatStyles(styles)
  }));
}));
MenuHeader.propTypes = { ...stylePropTypes()
};

const MenuGroup = defineName( /*#__PURE__*/forwardRef(function MenuGroup({
  className,
  styles,
  takeOverflow,
  ...restProps
}, externalRef) {
  const ref = useRef(null);
  const [overflowStyles, setOverflowStyles] = useState();
  const {
    overflow,
    overflowAmt
  } = useContext(MenuListContext);
  useIsomorphicLayoutEffect(() => {
    let maxHeight;

    if (takeOverflow && overflowAmt >= 0) {
      maxHeight = ref.current.getBoundingClientRect().height - overflowAmt;
      if (maxHeight < 0) maxHeight = 0;
    }

    setOverflowStyles(maxHeight >= 0 ? {
      maxHeight,
      overflow
    } : undefined);
  }, [takeOverflow, overflow, overflowAmt]);
  useIsomorphicLayoutEffect(() => {
    if (overflowStyles) ref.current.scrollTop = 0;
  }, [overflowStyles]);
  return /*#__PURE__*/React.createElement("div", Object.assign({}, restProps, {
    ref: useCombinedRef(externalRef, ref),
    className: useBEM({
      block: menuClass,
      element: menuGroupClass,
      className
    }),
    style: { ...useFlatStyles(styles),
      ...overflowStyles
    }
  }));
}), 'MenuGroup');
MenuGroup.propTypes = { ...stylePropTypes(),
  takeOverflow: PropTypes.bool
};

const MenuRadioGroup = defineName( /*#__PURE__*/forwardRef(function MenuRadioGroup({
  'aria-label': ariaLabel,
  className,
  styles,
  name,
  value,
  onRadioChange,
  ...restProps
}, externalRef) {
  const contextValue = useMemo(() => ({
    name,
    value,
    onRadioChange
  }), [name, value, onRadioChange]);
  return /*#__PURE__*/React.createElement(RadioGroupContext.Provider, {
    value: contextValue
  }, /*#__PURE__*/React.createElement("li", {
    role: "presentation"
  }, /*#__PURE__*/React.createElement("ul", Object.assign({
    role: "group",
    "aria-label": ariaLabel || name || 'Radio group'
  }, restProps, {
    ref: externalRef,
    className: useBEM({
      block: menuClass,
      element: radioGroupClass,
      className
    }),
    style: useFlatStyles(styles)
  }))));
}), 'MenuRadioGroup');
MenuRadioGroup.propTypes = { ...stylePropTypes(),
  name: PropTypes.string,
  value: PropTypes.any,
  onRadioChange: PropTypes.func
};

export { ControlledMenu, FocusableItem, Menu, MenuButton, MenuDivider, MenuGroup, MenuHeader, MenuItem, MenuRadioGroup, SubMenu, applyHOC, applyStatics, useMenuState };
