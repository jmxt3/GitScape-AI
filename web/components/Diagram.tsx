
import React, { useRef, useEffect, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import * as D3 from 'd3'; // Changed import
import { RawDiagramNode } from '../types';

interface DiagramProps {
  data: RawDiagramNode;
  repoName: string;
  defaultBranch: string;
  isInFullscreenModal?: boolean;
  onOpenFullscreenModal?: (data: RawDiagramNode, repoName: string, defaultBranch: string) => void;
  showTitle?: boolean; // New prop
}

const MaximizeViewportIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
    <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
    <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
    <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
  </svg>
);

const ExpandAllIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3v4M12 21v-4M3 12h4M21 12h-4"/>
    <path d="M12 7l-2-2M12 7l2-2M12 17l-2 2M12 17l2 2M7 12l-2 2M7 12l-2-2M17 12l2-2M17 12l2 2"/>
  </svg>
);

const CollapseAllIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" />
  </svg>
);

interface AppHierarchyPointNode extends D3.HierarchyPointNode<RawDiagramNode> {
  // Explicitly declare properties from D3.HierarchyNode/D3.HierarchyPointNode
  // to help TypeScript if inheritance resolution is problematic.
  data: RawDiagramNode;
  depth: number;
  x: number;
  y: number;
  
  // Custom properties
  _children?: AppHierarchyPointNode[];
  x0?: number;
  y0?: number;

  // Override properties from D3.HierarchyNode to use AppHierarchyPointNode for recursion
  children?: AppHierarchyPointNode[];
  parent: AppHierarchyPointNode | null; 
}


const DiagramComponent: React.FC<DiagramProps> = ({
  data,
  repoName,
  defaultBranch,
  isInFullscreenModal = false,
  onOpenFullscreenModal,
  showTitle = false,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDiagramInitialized, setIsDiagramInitialized] = useState(false);

  const d3RootRef = useRef<AppHierarchyPointNode | null>(null);
  const d3UpdateFuncRef = useRef<((source: AppHierarchyPointNode, transition: D3.Transition<any, any, any, any>) => void) | null>(null);
  const d3ZoomBehaviorRef = useRef<D3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const d3GRef = useRef<SVGGElement | null>(null);


  const margin = useMemo(() => ({ top: 30, right: 150, bottom: 30, left: 100 }), []);
  const initialScale = 0.85;
  const duration = 750;

  useLayoutEffect(() => {
    const ROPadding = 1;
    const resizeObserver = new ResizeObserver(entries => {
      if (!entries || !entries.length) return;
      const { width, height } = entries[0].contentRect;
      setDimensions(prevDims => {
          if (Math.abs(prevDims.width - width) > ROPadding || Math.abs(prevDims.height - height) > ROPadding) {
              return { width, height };
          }
          return prevDims;
      });
    });

    const currentContainerRef = containerRef.current;
    if (currentContainerRef) {
      resizeObserver.observe(currentContainerRef);
      const { width, height } = currentContainerRef.getBoundingClientRect();
      if (width > 0 && height > 0 && (dimensions.width !== width || dimensions.height !== height)) {
        setDimensions({ width, height });
      }
    }

    return () => {
      if (currentContainerRef) resizeObserver.unobserve(currentContainerRef);
      resizeObserver.disconnect();
    };
  }, []); 

  useEffect(() => {
    if (!data || !svgRef.current || dimensions.width <= 0 || dimensions.height <= 0 || !repoName || !defaultBranch) {
      setIsDiagramInitialized(false);
      return;
    }
    setIsDiagramInitialized(false);

    const svg = D3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = dimensions.width;
    const componentHeight = dimensions.height;

    svg.attr("viewBox", `0 0 ${width} ${componentHeight}`);

    const treeLayout = D3.tree<RawDiagramNode>().nodeSize([28, Math.max(150, (width - margin.left - margin.right) / (D3.hierarchy(data).height + 3))]);
    
    const hierarchyRootNodeBase: D3.HierarchyNode<RawDiagramNode> = D3.hierarchy(data, d_node => d_node.children);

    (hierarchyRootNodeBase as AppHierarchyPointNode).x0 = componentHeight / 2;
    (hierarchyRootNodeBase as AppHierarchyPointNode).y0 = margin.left;

    // Process nodes to set up _children (for collapsing)
    // Use D3.HierarchyNode for iteration as it's the guaranteed type from D3.hierarchy().each
    (hierarchyRootNodeBase as D3.HierarchyNode<RawDiagramNode>).each((d_node_iter) => {
      const d_node = d_node_iter as AppHierarchyPointNode; // Cast to AppHierarchyPointNode for our custom logic
      if (d_node.data.type === 'directory' && d_node.depth > 0 && d_node.children) {
        if (!d_node._children) d_node._children = d_node.children as AppHierarchyPointNode[];
        d_node.children = undefined; 
      }
    });
    
    d3RootRef.current = hierarchyRootNodeBase as AppHierarchyPointNode;
    treeLayout(d3RootRef.current); 

    const g = svg.append("g").attr("font-family", "sans-serif").attr("font-size", 11);
    d3GRef.current = g.node() as SVGGElement;

    const gLink = g.append("g")
        .attr("fill", "none")
        .attr("stroke", "#475569")
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", 1.5);

    const gNode = g.append("g")
        .attr("pointer-events", "all");

    const update = (source: AppHierarchyPointNode, transition: D3.Transition<any, any, any, any>) => {
      if (!d3RootRef.current) return;
      treeLayout(d3RootRef.current); 

      const treeNodes = (d3RootRef.current as D3.HierarchyPointNode<RawDiagramNode>).descendants() as AppHierarchyPointNode[];
      const treeLinks = (d3RootRef.current as D3.HierarchyPointNode<RawDiagramNode>).links() as D3.HierarchyPointLink<RawDiagramNode>[] as D3.HierarchyPointLink<AppHierarchyPointNode>[];


      const node = gNode.selectAll<SVGGElement, AppHierarchyPointNode>("g")
        .data(treeNodes, d => d.data.id); 

      const nodeEnter = node.enter().append("g")
        .attr("transform", `translate(${source.y0 ?? source.y},${source.x0 ?? source.x})`) 
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0)
        .on("click", (event, d) => { 
          if (d.data.type === 'directory') {
            if (d.children) { 
              if (!d._children) d._children = d.children;
              d.children = undefined;
            } else if (d._children) { 
              d.children = d._children;
            }
            const clickTransition = D3.transition().duration(duration);
            update(d, clickTransition); 
          } else if (d.data.type === 'file' && d.data.path) {
            const fileUrl = `https://github.com/${repoName}/blob/${defaultBranch}/${d.data.path}`;
            window.open(fileUrl, '_blank', 'noopener,noreferrer');
          }
        });

      nodeEnter.append("circle")
        .attr("r", d => d.data.type === 'directory' ? 7 : 5) 
        .attr("stroke", d => d.data.type === 'directory' ? "#22c55e" : "#c7ccd8")
        .attr("stroke-width", 2)
        .attr("fill", d => { 
          if (d.data.type === 'directory') {
            return d.children ? "#22c55e" : (d._children ? "#22c55e" : "#c7ccd8");
          }
          return "#c7ccd8";
        });

      nodeEnter.append("text")
        .attr("dy", "0.32em")
        .attr("x", d => (d.children || d._children) && d.data.type === 'directory' ? -12 : 12) 
        .attr("text-anchor", d => (d.children || d._children) && d.data.type === 'directory' ? "end" : "start")
        .attr("fill", "#cbd5e1")
        .text(d => d.data.name.length > 22 ? d.data.name.substring(0,20) + '...' : d.data.name) 
        .clone(true).lower()
          .attr("stroke-linejoin", "round")
          .attr("stroke-width", 3.5)
          .attr("stroke", "#0f172a");

      nodeEnter.append("title").text(d => d.data.path ? `${d.data.type}: ${d.data.path}` : d.data.name); 
      nodeEnter.style("cursor", d => (d.data.type === 'directory' && (d.children || d._children)) || d.data.type === 'file' ? "pointer" : "default");

      const nodeUpdate = node.merge(nodeEnter).transition(transition)
        .attr("transform", d => `translate(${d.y},${d.x})`) 
        .attr("fill-opacity", 1)
        .attr("stroke-opacity", 1);

      nodeUpdate.select<SVGCircleElement>("circle")
        .attr("fill", d => { 
          if (d.data.type === 'directory') {
            return d.children ? "#22c55e" : (d._children ? "#22c55e" : "#c7ccd8");
          }
          return "#c7ccd8";
        });

      nodeUpdate.select<SVGTextElement>("text")
        .attr("x", d => (d.children || d._children) && d.data.type === 'directory' ? -12 : 12) 
        .attr("text-anchor", d => (d.children || d._children) && d.data.type === 'directory' ? "end" : "start");

      node.exit().transition(transition).remove()
        .attr("transform", `translate(${source.y},${source.x})`) 
        .attr("fill-opacity", 0)
        .attr("stroke-opacity", 0);

      const linkGenerator = D3.linkHorizontal<any, AppHierarchyPointNode>()
        .x(n => n.y) 
        .y(n => n.x); 
      
      const link = gLink.selectAll<SVGPathElement, D3.HierarchyPointLink<AppHierarchyPointNode>>("path")
        .data(treeLinks, d_link => {
            const linkSourceNode = d_link.source as AppHierarchyPointNode;
            const linkTargetNode = d_link.target as AppHierarchyPointNode;
            return `${linkSourceNode.data.id}->${linkTargetNode.data.id}`;
        });

      const linkEnter = link.enter().append("path")
        .attr("d", _ => { 
          const o = { x: source.x0 ?? source.x, y: source.y0 ?? source.y }; 
          return linkGenerator({ source: o as any, target: o as any });
        });

      link.merge(linkEnter).transition(transition)
        .attr("d", d_link => linkGenerator(d_link)); 

      link.exit().transition(transition).remove()
        .attr("d", _ => {
          const o = { x: source.x, y: source.y }; 
          return linkGenerator({ source: o as any, target: o as any });
        });

      (d3RootRef.current as D3.HierarchyPointNode<RawDiagramNode>).eachBefore(d_node_base => {
        const d_node = d_node_base as AppHierarchyPointNode;
        d_node.x0 = d_node.x;
        d_node.y0 = d_node.y;
      });
    };

    d3UpdateFuncRef.current = update;
    const initialTransition = D3.transition().duration(duration);
    update(d3RootRef.current, initialTransition); 

    const zoom = D3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.05, 5])
        .on("zoom", (event) => {
            if (d3GRef.current) {
              D3.select(d3GRef.current).attr("transform", event.transform.toString());
            }
        });
    d3ZoomBehaviorRef.current = zoom;
    
    const initialTx = margin.left + 60; 
    const initialTy = componentHeight / 2; 

    const calculatedInitialTransform = D3.zoomIdentity
      .translate(initialTx, initialTy)
      .scale(initialScale)
      .translate(-((d3RootRef.current as AppHierarchyPointNode).y ?? 0), -((d3RootRef.current as AppHierarchyPointNode).x ?? 0)); 

    svg.call(zoom)
       .call(zoom.transform, calculatedInitialTransform);

    setIsDiagramInitialized(true);

  }, [data, dimensions, repoName, defaultBranch, margin, initialScale, duration]);


  const expandCollapseAll = useCallback((collapseRequest: boolean) => {
    if (d3RootRef.current && d3UpdateFuncRef.current) {
      const hierarchyRootNode = d3RootRef.current; 
      (hierarchyRootNode as D3.HierarchyPointNode<RawDiagramNode>).each((d_node_base) => {
        const d_node = d_node_base as AppHierarchyPointNode;
        if (d_node.data.type === 'directory') {
            if (collapseRequest) {
                if (d_node.depth > 0 && d_node.children) { 
                    if (!d_node._children) d_node._children = d_node.children;
                    d_node.children = undefined;
                }
            } else {
                if (d_node._children) {
                    d_node.children = d_node._children;
                }
            }
        }
      });
      const transition = D3.transition().duration(duration);
      d3UpdateFuncRef.current(hierarchyRootNode, transition); 
    }
  }, [duration]);

  const handleExpandAll = useCallback(() => expandCollapseAll(false), [expandCollapseAll]);
  const handleCollapseAll = useCallback(() => expandCollapseAll(true), [expandCollapseAll]);

  const handleMaximizeClick = () => {
    if (onOpenFullscreenModal && !isInFullscreenModal) {
      onOpenFullscreenModal(data, repoName, defaultBranch);
    }
  };

  const buttonBaseClasses = "p-1.5 bg-slate-700/80 hover:bg-slate-600/80 text-slate-200 rounded-md shadow-md transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col h-full w-full">
      {showTitle && (
        <h3 className="text-lg font-medium text-green-400 mb-3">Generated Diagram</h3>
      )}
      <div
        ref={containerRef}
        className={`relative border border-slate-700 rounded-lg
          ${isInFullscreenModal
            ? 'flex-grow w-full bg-slate-800/95'
            : 'w-full h-full bg-slate-900/95 backdrop-blur-sm shadow-xl overflow-hidden'
          }
        `}
      >
        <div className="absolute top-3 right-3 z-10 flex space-x-1.5">
          {!isInFullscreenModal && onOpenFullscreenModal && (
            <button
              onClick={handleMaximizeClick}
              className={buttonBaseClasses}
              aria-label="Enter Fullscreen View"
              title="Enter Fullscreen View"
              disabled={!isDiagramInitialized}
            >
              <MaximizeViewportIcon />
            </button>
          )}
          <button
            onClick={handleExpandAll}
            className={buttonBaseClasses}
            aria-label="Expand All Nodes"
            title="Expand All Nodes"
            disabled={!isDiagramInitialized}
          >
            <ExpandAllIcon />
          </button>
          <button
            onClick={handleCollapseAll}
            className={buttonBaseClasses}
            aria-label="Collapse All Nodes to First Level"
            title="Collapse All Nodes to First Level"
            disabled={!isDiagramInitialized}
          >
            <CollapseAllIcon />
          </button>
        </div>
        <svg ref={svgRef} className="w-full h-full select-none block"></svg>
         {!isDiagramInitialized && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm pointer-events-none">
            <p className="text-slate-400 text-lg">Initializing Diagram...</p>
          </div>
        )}
      </div>
    </div>
  );
};
export const Diagram = React.memo(DiagramComponent);
